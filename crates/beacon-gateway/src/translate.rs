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

// ---------------------------------------------------------------------
// Subscription providers (ported from 7server's formats.ts)
// ---------------------------------------------------------------------
/// Claude OAuth tokens are only accepted for requests that identify as Claude Code.
pub const CLAUDE_CODE_SYSTEM: &str = "You are Claude Code, Anthropic's official CLI for Claude.";

pub fn openai_to_claude_oauth(body: &Value, model: &str) -> Value {
    let mut out = openai_to_anthropic(body, model);
    let mut system = vec![json!({ "type": "text", "text": CLAUDE_CODE_SYSTEM })];
    if let Some(sys) = out.get("system").and_then(|v| v.as_str()) {
        system.push(json!({ "type": "text", "text": sys }));
    }
    out["system"] = json!(system);
    out["stream"] = json!(true);
    out
}

pub fn openai_to_gemini(body: &Value, model: &str, project: Option<&str>) -> Value {
    let msgs = body.get("messages").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    let name_of = |id: &str| -> String {
        for m in &msgs {
            for c in m.get("tool_calls").and_then(|t| t.as_array()).into_iter().flatten() {
                if c["id"].as_str() == Some(id) {
                    return c["function"]["name"].as_str().unwrap_or("tool").to_string();
                }
            }
        }
        "tool".into()
    };
    let mut sys = Vec::new();
    let mut contents: Vec<Value> = Vec::new();
    for m in &msgs {
        let role = m["role"].as_str().unwrap_or("");
        let text = extract_text(m.get("content").unwrap_or(&Value::Null));
        let (grole, parts) = match role {
            "system" | "developer" => { if !text.is_empty() { sys.push(text); } continue; }
            "tool" => {
                let resp = serde_json::from_str::<Value>(&text).ok().filter(|v| v.is_object()).unwrap_or(json!({ "result": text }));
                ("user", vec![json!({ "functionResponse": { "name": name_of(m["tool_call_id"].as_str().unwrap_or("")), "response": resp } })])
            }
            "assistant" => {
                let mut p = Vec::new();
                if !text.is_empty() { p.push(json!({ "text": text })); }
                for c in m.get("tool_calls").and_then(|t| t.as_array()).into_iter().flatten() {
                    let args: Value = serde_json::from_str(c["function"]["arguments"].as_str().unwrap_or("{}")).unwrap_or(json!({}));
                    p.push(json!({ "functionCall": { "name": c["function"]["name"], "args": args } }));
                }
                ("model", p)
            }
            _ => ("user", vec![json!({ "text": text })]),
        };
        if parts.is_empty() { continue; }
        // Gemini needs alternating turns: merge same-role neighbours.
        match contents.last_mut() {
            Some(last) if last["role"] == grole => last["parts"].as_array_mut().unwrap().extend(parts),
            _ => contents.push(json!({ "role": grole, "parts": parts })),
        }
    }
    let mut request = json!({ "contents": contents, "generationConfig": {} });
    if !sys.is_empty() {
        request["systemInstruction"] = json!({ "parts": [{ "text": sys.join("\n\n") }] });
    }
    if let Some(mt) = body.get("max_tokens").or_else(|| body.get("max_completion_tokens")) {
        request["generationConfig"]["maxOutputTokens"] = mt.clone();
    }
    if let Some(t) = body.get("temperature") {
        request["generationConfig"]["temperature"] = t.clone();
    }
    let decls: Vec<Value> = body.get("tools").and_then(|t| t.as_array()).into_iter().flatten()
        .filter_map(|t| t.get("function"))
        .map(|f| json!({ "name": f["name"], "description": f.get("description").cloned().unwrap_or(json!("")), "parameters": f.get("parameters").cloned().unwrap_or(json!({ "type": "object", "properties": {} })) }))
        .collect();
    if !decls.is_empty() {
        request["tools"] = json!([{ "functionDeclarations": decls }]);
    }
    json!({ "model": model, "project": project, "request": request })
}

/// Translates a provider's SSE events into OpenAI chat.completion.chunk frames.
pub struct SseToOpenAi {
    pub base: CodexStreamTranslator,
    kind: &'static str,
    claude_tools: HashMap<u64, usize>,
    tool_count: usize,
    finished: bool,
}

impl SseToOpenAi {
    pub fn new(kind: &'static str, public_model: String) -> Self {
        Self { base: CodexStreamTranslator::new(public_model), kind, claude_tools: HashMap::new(), tool_count: 0, finished: false }
    }

    fn tool_frame(&self, index: usize, id: Option<&str>, name: Option<&str>, args: &str) -> String {
        let mut call = json!({ "index": index, "function": { "arguments": args } });
        if let (Some(id), Some(name)) = (id, name) {
            call["id"] = json!(id);
            call["type"] = json!("function");
            call["function"]["name"] = json!(name);
        }
        self.base.chunk_data(json!({ "tool_calls": [call] }), None)
    }

    fn finish(&mut self, reason: &str) -> Vec<String> {
        if self.finished { return vec![]; }
        self.finished = true;
        let reason = if self.tool_count > 0 { "tool_calls" } else { reason };
        vec![self.base.chunk_data(json!({}), Some(reason)), "data: [DONE]\n\n".to_string()]
    }

    /// Err carries an upstream error event.
    pub fn feed(&mut self, ev: &Value) -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        if self.kind == "claude" {
            match ev["type"].as_str().unwrap_or("") {
                "content_block_start" if ev["content_block"]["type"] == "tool_use" => {
                    let idx = self.tool_count;
                    self.claude_tools.insert(ev["index"].as_u64().unwrap_or(0), idx);
                    self.tool_count += 1;
                    out.push(self.tool_frame(idx, ev["content_block"]["id"].as_str(), ev["content_block"]["name"].as_str(), ""));
                }
                "content_block_delta" => {
                    let d = &ev["delta"];
                    if d["type"] == "text_delta" {
                        if let Some(t) = d["text"].as_str().filter(|t| !t.is_empty()) {
                            out.push(self.base.chunk_data(json!({ "content": t }), None));
                        }
                    } else if d["type"] == "input_json_delta" {
                        if let Some(&idx) = self.claude_tools.get(&ev["index"].as_u64().unwrap_or(0)) {
                            out.push(self.tool_frame(idx, None, None, d["partial_json"].as_str().unwrap_or("")));
                        }
                    }
                }
                "message_delta" => {
                    if let Some(r) = ev["delta"]["stop_reason"].as_str() {
                        out.extend(self.finish(if r == "max_tokens" { "length" } else { "stop" }));
                    }
                }
                "message_stop" => out.extend(self.finish("stop")),
                "error" => return Err(ev["error"]["message"].as_str().unwrap_or("Claude error").to_string()),
                _ => {}
            }
        } else {
            // gemini: events are {response:{candidates:[...]}}; function calls arrive whole.
            let r = ev.get("response").unwrap_or(ev);
            let cand = &r["candidates"][0];
            for part in cand["content"]["parts"].as_array().into_iter().flatten() {
                if part["thought"] == true { continue; }
                if let Some(t) = part["text"].as_str().filter(|t| !t.is_empty()) {
                    out.push(self.base.chunk_data(json!({ "content": t }), None));
                }
                if let Some(fc) = part.get("functionCall") {
                    let idx = self.tool_count;
                    self.tool_count += 1;
                    let id = format!("call_{}_{}", idx, Uuid::new_v4().simple());
                    let args = serde_json::to_string(fc.get("args").unwrap_or(&json!({}))).unwrap_or_default();
                    out.push(self.tool_frame(idx, Some(&id), fc["name"].as_str(), &args));
                }
            }
            if let Some(fr) = cand["finishReason"].as_str() {
                out.extend(self.finish(if fr == "MAX_TOKENS" { "length" } else { "stop" }));
            }
            if let Some(e) = ev.get("error") {
                return Err(e["message"].as_str().unwrap_or("Gemini error").to_string());
            }
        }
        Ok(out)
    }

    /// Called when the upstream stream ends, in case it never sent a stop event.
    pub fn end(&mut self) -> Vec<String> {
        self.finish("stop")
    }
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

    #[test]
    fn claude_sse_translates_text_and_tools() {
        let mut t = SseToOpenAi::new("claude", "cc/claude-sonnet-5-5".into());
        assert!(t.feed(&json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}})).unwrap()[0].contains("\"content\":\"Hi\""));
        let start = t.feed(&json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"probe"}})).unwrap();
        assert!(start[0].contains("\"name\":\"probe\"") && start[0].contains("\"index\":0"));
        let args = t.feed(&json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"a\":1"}})).unwrap();
        assert!(args[0].contains("arguments"));
        let end = t.feed(&json!({"type":"message_delta","delta":{"stop_reason":"tool_use"}})).unwrap();
        assert!(end[0].contains("tool_calls") && end[1].contains("[DONE]"));
        assert!(t.end().is_empty());
        assert!(t.feed(&json!({"type":"error","error":{"message":"overloaded"}})).is_err());
    }

    #[test]
    fn claude_oauth_body_leads_with_claude_code_identity() {
        let b = openai_to_claude_oauth(&json!({"messages":[{"role":"system","content":"Be terse"},{"role":"user","content":"Ping"}]}), "claude-sonnet-5-5");
        assert_eq!(b["system"][0]["text"], CLAUDE_CODE_SYSTEM);
        assert_eq!(b["system"][1]["text"], "Be terse");
        assert_eq!(b["stream"], true);
    }

    #[test]
    fn gemini_body_and_stream() {
        let g = openai_to_gemini(&json!({"messages":[{"role":"system","content":"S"},{"role":"user","content":"a"},{"role":"user","content":"b"}]}), "gemini-2.5-flash", Some("proj"));
        assert_eq!(g["project"], "proj");
        assert_eq!(g["request"]["contents"].as_array().unwrap().len(), 1, "same-role turns merge");
        let mut t = SseToOpenAi::new("gemini", "gc/gemini-2.5-flash".into());
        let out = t.feed(&json!({"response":{"candidates":[{"content":{"parts":[{"text":"yo"},{"functionCall":{"name":"f","args":{}}}]},"finishReason":"STOP"}]}})).unwrap();
        assert!(out[0].contains("yo") && out[1].contains("\"name\":\"f\"") && out[2].contains("tool_calls"));
    }
}
