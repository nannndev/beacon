use crate::prompt::BEACON_AGENT_SYSTEM_PROMPT;
use crate::tools::{agent_tool_definitions, execute_tool};
use async_stream::stream;
use axum::response::sse::Event;
use beacon_core::TestConfig;
use beacon_gateway::GatewayEngine;
use futures::{Stream, StreamExt};
use serde_json::{json, Value};
use std::convert::Infallible;
use uuid::Uuid;

pub struct AgentOrchestrator {
    pub gateway: GatewayEngine,
}

impl AgentOrchestrator {
    pub fn new(gateway: GatewayEngine) -> Self {
        Self { gateway }
    }

    pub fn run_stream(
        &self,
        mut messages: Vec<Value>,
        model: Option<String>,
        config: TestConfig,
    ) -> impl Stream<Item = Result<Event, Infallible>> {
        let gateway = self.gateway.clone();
        let tools = agent_tool_definitions();
        let chosen_model = model.unwrap_or_else(|| "auto".to_string());

        stream! {
            let has_system = messages.iter().any(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"));
            if !has_system {
                messages.insert(0, json!({
                    "role": "system",
                    "content": BEACON_AGENT_SYSTEM_PROMPT
                }));
            }

            let mut turn = 0;
            const MAX_TURNS: usize = 5;

            while turn < MAX_TURNS {
                turn += 1;

                let req_body = json!({
                    "model": chosen_model,
                    "messages": messages,
                    "tools": tools,
                    "stream": true,
                });

                let res = gateway.chat_completions(req_body).await;
                match res {
                    Ok(resp) => {
                        let mut body_stream = resp.into_body().into_data_stream();
                        let mut assistant_text = String::new();
                        let mut tool_calls: Vec<Value> = Vec::new();

                        while let Some(chunk_res) = body_stream.next().await {
                            if let Ok(bytes) = chunk_res {
                                let chunk_str = String::from_utf8_lossy(&bytes);
                                for line in chunk_str.lines() {
                                    let line_trim = line.trim();
                                    if let Some(payload) = line_trim.strip_prefix("data:") {
                                        let payload = payload.trim();
                                        if payload == "[DONE]" {
                                            continue;
                                        }
                                        if let Ok(val) = serde_json::from_str::<Value>(payload) {
                                            if let Some(choices) = val.get("choices").and_then(|c| c.as_array()) {
                                                if let Some(first) = choices.first() {
                                                    if let Some(delta) = first.get("delta") {
                                                        if let Some(txt) = delta.get("content").and_then(|c| c.as_str()) {
                                                            if !txt.is_empty() {
                                                                assistant_text.push_str(txt);
                                                                let evt_json = json!({ "_kind": "delta", "delta": txt });
                                                                yield Ok(Event::default().data(serde_json::to_string(&evt_json).unwrap()));
                                                            }
                                                        }
                                                        if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
                                                            for tc in tcs {
                                                                let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                                                                while tool_calls.len() <= idx {
                                                                    tool_calls.push(json!({
                                                                        "id": format!("call_{}", Uuid::new_v4().simple()),
                                                                        "type": "function",
                                                                        "function": { "name": "", "arguments": "" }
                                                                    }));
                                                                }
                                                                let slot = &mut tool_calls[idx];
                                                                if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                                                                    slot["id"] = json!(id);
                                                                }
                                                                if let Some(fn_obj) = tc.get("function") {
                                                                    if let Some(name) = fn_obj.get("name").and_then(|n| n.as_str()) {
                                                                        slot["function"]["name"] = json!(format!("{}{}", slot["function"]["name"].as_str().unwrap_or(""), name));
                                                                    }
                                                                    if let Some(args) = fn_obj.get("arguments").and_then(|a| a.as_str()) {
                                                                        slot["function"]["arguments"] = json!(format!("{}{}", slot["function"]["arguments"].as_str().unwrap_or(""), args));
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if !assistant_text.is_empty() && tool_calls.is_empty() {
                            messages.push(json!({
                                "role": "assistant",
                                "content": assistant_text
                            }));
                            let done_evt = json!({ "_kind": "done" });
                            yield Ok(Event::default().data(serde_json::to_string(&done_evt).unwrap()));
                            break;
                        }

                        if !tool_calls.is_empty() {
                            messages.push(json!({
                                "role": "assistant",
                                "content": assistant_text,
                                "tool_calls": tool_calls
                            }));

                            for tc in &tool_calls {
                                let call_id = tc.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                let fn_name = tc.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()).unwrap_or("");
                                let fn_args_str = tc.get("function").and_then(|f| f.get("arguments")).and_then(|a| a.as_str()).unwrap_or("{}");
                                let fn_args: Value = serde_json::from_str(fn_args_str).unwrap_or(json!({}));

                                let start_evt = json!({
                                    "_kind": "call_start",
                                    "call_id": call_id,
                                    "name": fn_name,
                                    "args": fn_args
                                });
                                yield Ok(Event::default().data(serde_json::to_string(&start_evt).unwrap()));

                                let tool_res = execute_tool(fn_name, &fn_args, &config).await;

                                let finish_evt = json!({
                                    "_kind": "call_finish",
                                    "call_id": call_id,
                                    "name": fn_name,
                                    "result": tool_res
                                });
                                yield Ok(Event::default().data(serde_json::to_string(&finish_evt).unwrap()));

                                messages.push(json!({
                                    "role": "tool",
                                    "tool_call_id": call_id,
                                    "content": serde_json::to_string(&tool_res).unwrap_or_default()
                                }));
                            }
                            continue;
                        }

                        break;
                    }
                    Err((status, err_json)) => {
                        let err_evt = json!({
                            "_kind": "error",
                            "status": status.as_u16(),
                            "error": err_json.0
                        });
                        yield Ok(Event::default().data(serde_json::to_string(&err_evt).unwrap()));
                        break;
                    }
                }
            }
        }
    }
}
