use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn extract_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(arr) => {
            let mut out = String::new();
            for part in arr {
                if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                    out.push_str(txt);
                }
            }
            out
        }
        _ => String::new(),
    }
}

// ---------------------------------------------------------------------
// OpenAI -> Codex Responses
// ---------------------------------------------------------------------
pub fn openai_to_codex(body: &Value, upstream_model: &str) -> Value {
    let mut system_parts = Vec::new();
    let mut items = Vec::new();

    if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
        for m in messages {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role == "system" || role == "developer" {
                let txt = extract_text(m.get("content").unwrap_or(&Value::Null));
                if !txt.is_empty() {
                    system_parts.push(txt);
                }
                continue;
            }
            if role == "tool" {
                items.push(json!({
                    "type": "function_call_output",
                    "call_id": m.get("tool_call_id").and_then(|t| t.as_str()).unwrap_or(""),
                    "output": extract_text(m.get("content").unwrap_or(&Value::Null)),
                }));
                continue;
            }
            let text = extract_text(m.get("content").unwrap_or(&Value::Null));
            if !text.is_empty() || role == "user" {
                items.push(json!({
                    "type": "message",
                    "role": role,
                    "content": [{
                        "type": if role == "assistant" { "output_text" } else { "input_text" },
                        "text": text,
                    }]
                }));
            }
            if role == "assistant" {
                if let Some(tool_calls) = m.get("tool_calls").and_then(|t| t.as_array()) {
                    for c in tool_calls {
                        let fn_obj = c.get("function").cloned().unwrap_or(json!({}));
                        items.push(json!({
                            "type": "function_call",
                            "call_id": c.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                            "name": fn_obj.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                            "arguments": fn_obj.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}"),
                        }));
                    }
                }
            }
        }
    }

    let mut out = json!({
        "model": upstream_model,
        "instructions": system_parts.join("\n\n"),
        "input": items,
        "stream": true,
        "store": false,
        "include": [],
    });

    if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
        if !tools.is_empty() {
            let mut codex_tools = Vec::new();
            for t in tools {
                if let Some(fn_obj) = t.get("function") {
                    codex_tools.push(json!({
                        "type": "function",
                        "name": fn_obj.get("name").unwrap_or(&json!("")),
                        "description": fn_obj.get("description").unwrap_or(&json!("")),
                        "parameters": fn_obj.get("parameters").unwrap_or(&json!({"type": "object", "properties": {}})),
                        "strict": false,
                    }));
                }
            }
            out["tools"] = Value::Array(codex_tools);
            out["parallel_tool_calls"] = json!(true);
        }
    }

    out
}

pub struct CodexStreamTranslator {
    pub public_model: String,
    pub id: String,
    pub created: u64,
    pub by_item: HashMap<String, usize>,
    pub tool_calls: Vec<Value>,
}

impl CodexStreamTranslator {
    pub fn new(public_model: String) -> Self {
        Self {
            public_model,
            id: format!("chatcmpl-{}", Uuid::new_v4().simple()),
            created: now_secs(),
            by_item: HashMap::new(),
            tool_calls: Vec::new(),
        }
    }

    pub fn start_chunk(&self) -> String {
        self.chunk_data(json!({
            "role": "assistant",
            "content": ""
        }), None)
    }

    pub fn chunk_data(&self, delta: Value, finish_reason: Option<&str>) -> String {
        let frame = json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.public_model,
            "choices": [{
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }]
        });
        format!("data: {}\n\n", serde_json::to_string(&frame).unwrap_or_default())
    }

    pub fn feed(&mut self, ev: &Value) -> Vec<String> {
        let mut chunks = Vec::new();
        let ev_type = ev.get("type").and_then(|t| t.as_str()).unwrap_or("");

        if ev_type == "response.output_text.delta" {
            if let Some(delta_str) = ev.get("delta").and_then(|d| d.as_str()) {
                if !delta_str.is_empty() {
                    chunks.push(self.chunk_data(json!({ "content": delta_str }), None));
                }
            }
        } else if ev_type == "response.output_item.added" {
            if let Some(item) = ev.get("item") {
                if item.get("type").and_then(|t| t.as_str()) == Some("function_call") {
                    let index = self.tool_calls.len();
                    let item_id = item.get("id").and_then(|i| i.as_str()).unwrap_or("");
                    let call_id = item.get("call_id").and_then(|c| c.as_str()).unwrap_or(item_id);
                    let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let args = item.get("arguments").and_then(|a| a.as_str()).unwrap_or("");

                    self.by_item.insert(item_id.to_string(), index);
                    self.tool_calls.push(json!({
                        "id": call_id,
                        "type": "function",
                        "function": { "name": name, "arguments": args },
                    }));

                    chunks.push(self.chunk_data(json!({
                        "tool_calls": [{
                            "index": index,
                            "id": call_id,
                            "type": "function",
                            "function": { "name": name, "arguments": args },
                        }]
                    }), None));
                }
            }
        } else if ev_type == "response.function_call_arguments.delta" {
            if let Some(item_id) = ev.get("item_id").and_then(|i| i.as_str()) {
                if let Some(&index) = self.by_item.get(item_id) {
                    let delta_args = ev.get("delta").and_then(|d| d.as_str()).unwrap_or("");
                    chunks.push(self.chunk_data(json!({
                        "tool_calls": [{
                            "index": index,
                            "function": { "arguments": delta_args }
                        }]
                    }), None));
                }
            }
        } else if ev_type == "response.completed" {
            chunks.push(self.chunk_data(json!({}), Some("stop")));
            chunks.push("data: [DONE]\n\n".to_string());
        }

        chunks
    }
}

// ---------------------------------------------------------------------
// OpenAI -> Anthropic Messages
// ---------------------------------------------------------------------
pub fn openai_to_anthropic(body: &Value, model: &str) -> Value {
    let mut system_parts = Vec::new();
    let mut turns = Vec::new();

    if let Some(messages) = body.get("messages").and_then(|m| m.as_array()) {
        for m in messages {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if role == "system" || role == "developer" {
                let txt = extract_text(m.get("content").unwrap_or(&Value::Null));
                if !txt.is_empty() {
                    system_parts.push(txt);
                }
                continue;
            }
            if role == "tool" {
                turns.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.get("tool_call_id").and_then(|t| t.as_str()).unwrap_or(""),
                        "content": extract_text(m.get("content").unwrap_or(&Value::Null)),
                    }]
                }));
            } else if role == "assistant" {
                let mut blocks = Vec::new();
                let txt = extract_text(m.get("content").unwrap_or(&Value::Null));
                if !txt.is_empty() {
                    blocks.push(json!({ "type": "text", "text": txt }));
                }
                if let Some(calls) = m.get("tool_calls").and_then(|t| t.as_array()) {
                    for c in calls {
                        let fn_obj = c.get("function").cloned().unwrap_or(json!({}));
                        let args_str = fn_obj.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}");
                        let args_val: Value = serde_json::from_str(args_str).unwrap_or(json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": c.get("id").and_then(|i| i.as_str()).unwrap_or(&format!("toolu_{}", Uuid::new_v4().simple())),
                            "name": fn_obj.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                            "input": args_val,
                        }));
                    }
                }
                turns.push(json!({ "role": "assistant", "content": blocks }));
            } else {
                let txt = extract_text(m.get("content").unwrap_or(&Value::Null));
                turns.push(json!({
                    "role": "user",
                    "content": [{ "type": "text", "text": txt }],
                }));
            }
        }
    }

    let max_tokens = body
        .get("max_tokens")
        .or_else(|| body.get("max_completion_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(8192);

    let mut out = json!({
        "model": model,
        "messages": turns,
        "max_tokens": max_tokens,
    });

    if !system_parts.is_empty() {
        out["system"] = json!(system_parts.join("\n\n"));
    }
    if let Some(temp) = body.get("temperature") {
        out["temperature"] = temp.clone();
    }
    if let Some(tools) = body.get("tools").and_then(|t| t.as_array()) {
        let mut anthropic_tools = Vec::new();
        for t in tools {
            if let Some(fn_obj) = t.get("function") {
                anthropic_tools.push(json!({
                    "name": fn_obj.get("name").unwrap_or(&json!("")),
                    "description": fn_obj.get("description").unwrap_or(&json!("")),
                    "input_schema": fn_obj.get("parameters").unwrap_or(&json!({"type": "object", "properties": {}})),
                }));
            }
        }
        if !anthropic_tools.is_empty() {
            out["tools"] = Value::Array(anthropic_tools);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_to_codex_conversion() {
        let body = json!({
            "model": "cx/gpt-5.6-terra",
            "messages": [
                { "role": "system", "content": "You are Beacon AI." },
                { "role": "user", "content": "Hello world" }
            ]
        });

        let codex = openai_to_codex(&body, "gpt-5.6-terra");
        assert_eq!(codex["model"], "gpt-5.6-terra");
        assert_eq!(codex["instructions"], "You are Beacon AI.");
        assert_eq!(codex["input"].as_array().unwrap().len(), 1);
        assert_eq!(codex["input"][0]["role"], "user");
    }

    #[test]
    fn test_openai_to_anthropic_conversion() {
        let body = json!({
            "model": "an/claude-sonnet-5-5",
            "messages": [
                { "role": "system", "content": "System prompt" },
                { "role": "user", "content": "Ping" }
            ]
        });

        let anthropic = openai_to_anthropic(&body, "claude-sonnet-5-5");
        assert_eq!(anthropic["model"], "claude-sonnet-5-5");
        assert_eq!(anthropic["system"], "System prompt");
        assert_eq!(anthropic["messages"].as_array().unwrap().len(), 1);
    }
}
