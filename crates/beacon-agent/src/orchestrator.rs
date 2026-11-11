use crate::prompt::BEACON_AGENT_SYSTEM_PROMPT;
use crate::tools::{agent_tool_definitions, execute_tool, WorkspaceOps};
use async_stream::stream;
use axum::response::sse::Event;
use beacon_gateway::GatewayEngine;
use futures::{Stream, StreamExt};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;
use uuid::Uuid;

/// Base prompt plus the live UI context and user preferences the frontend sends
/// with every chat request (project, environment, selection, language, guides,
/// custom instructions, project notes, enabled SKILL.md files, scope).
pub fn build_system_prompt(context: &Value) -> String {
    let s = |k: &str| context.get(k).and_then(|v| v.as_str()).filter(|v| !v.is_empty());
    let mut out = String::from(BEACON_AGENT_SYSTEM_PROMPT);
    if context.is_null() {
        return out;
    }
    out.push_str("\n\nLIVE WORKSPACE CONTEXT (from the Beacon UI right now):\n");
    match s("projectName") {
        Some(name) => out.push_str(&format!("- Active project: {} (id={})\n", name, s("projectId").unwrap_or("?"))),
        None => out.push_str("- Active project: none selected\n"),
    }
    if let Some(env) = s("environmentName") {
        out.push_str(&format!("- Environment: {}\n", env));
    }
    out.push_str(&format!("- Base URL: {}\n", s("baseUrl").unwrap_or("(unset)")));
    if let Some(view) = s("view") {
        out.push_str(&format!("- Current view: {}\n", view));
    }
    if let Some(ep) = s("selectedEndpointName") {
        out.push_str(&format!(
            "- Selected endpoint: {} {} (name=\"{}\", id={})\n",
            s("selectedEndpointMethod").unwrap_or("GET"),
            s("selectedEndpointUrl").unwrap_or(""),
            ep,
            s("selectedEndpointId").unwrap_or("")
        ));
    }
    if let Some(r) = context.get("lastSendResult").filter(|v| v.is_object()) {
        out.push_str(&format!(
            "- Last send result: HTTP {} in {}ms, ok={}{}\n",
            r.get("status_code").map(|v| v.to_string()).unwrap_or_else(|| "error".into()),
            r.get("elapsed_ms").map(|v| v.to_string()).unwrap_or_else(|| "?".into()),
            r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false),
            r.get("error").and_then(|v| v.as_str()).map(|e| format!(", error: {}", e)).unwrap_or_default()
        ));
    }

    let prefs = match context.get("preferences").filter(|v| v.is_object()) {
        Some(p) => p,
        None => return out,
    };
    let ps = |k: &str| prefs.get(k).and_then(|v| v.as_str()).filter(|v| !v.is_empty());
    out.push_str("\nUSER PREFERENCES:\n");
    match ps("scope") {
        Some("workspace") => out.push_str(&format!(
            "- Scope: WORKSPACE-LOCKED to the active project{}. Do not call beacon_switch_project or beacon_create_project unless the user explicitly asks to change projects.\n",
            s("projectName").map(|n| format!(" \"{}\"", n)).unwrap_or_default()
        )),
        _ => out.push_str("- Scope: GLOBAL. You may list, switch, and create projects freely with the project tools.\n"),
    }
    match ps("language") {
        Some("id") => out.push_str("- Language: always reply in Indonesian.\n"),
        Some("en") => out.push_str("- Language: always reply in English.\n"),
        _ => {}
    }
    match ps("style") {
        Some("concise") => out.push_str("- Length: concise, no filler.\n"),
        Some("detailed") => out.push_str("- Length: detailed, with explanations.\n"),
        _ => {}
    }
    if let Some(guides) = prefs.get("guides").and_then(|g| g.as_array()) {
        for g in guides.iter().filter_map(|g| g.as_str()) {
            let text = match g {
                "verify-live-first" => "Inspect state or probe with a single request before mutating endpoints or running concurrent load.",
                "capture-examples" => "When an endpoint succeeds live, capture its response as the documented example and add smart assertions.",
                "explain-actions" => "Briefly state what each tool action checks or modifies before invoking it.",
                "summary-table" => "Conclude audits, scenarios, and multi-endpoint runs with a concise markdown summary table.",
                other => other,
            };
            out.push_str(&format!("- Guide: {}\n", text));
        }
    }
    if let Some(custom) = ps("custom") {
        out.push_str(&format!("- Custom instructions: {}\n", custom));
    }
    if let (Some(pid), Some(notes)) = (s("projectId"), prefs.get("projectNotes").and_then(|n| n.as_object())) {
        if let Some(note) = notes.get(pid).and_then(|v| v.as_str()).filter(|v| !v.is_empty()) {
            out.push_str(&format!("- Notes for this project: {}\n", note));
        }
    }
    if let Some(skills) = prefs.get("skills").and_then(|k| k.as_array()) {
        for sk in skills.iter().filter(|sk| sk.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false)) {
            let name = sk.get("name").and_then(|v| v.as_str()).unwrap_or("skill");
            let content: String = sk.get("content").and_then(|v| v.as_str()).unwrap_or("").chars().take(4000).collect();
            if !content.trim().is_empty() {
                out.push_str(&format!("\nSKILL \"{}\":\n{}\n", name, content));
            }
        }
    }
    out
}

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
        workspace: Arc<dyn WorkspaceOps>,
        max_steps: usize,
        context: Value,
    ) -> impl Stream<Item = Result<Event, Infallible>> {
        let gateway = self.gateway.clone();
        let tools = agent_tool_definitions();
        let chosen_model = model.unwrap_or_else(|| "auto".to_string());

        stream! {
            let model_evt = json!({ "type": "model", "model": chosen_model });
            yield Ok(Event::default().data(serde_json::to_string(&model_evt).unwrap()));

            let has_system = messages.iter().any(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"));
            if !has_system {
                messages.insert(0, json!({
                    "role": "system",
                    "content": build_system_prompt(&context)
                }));
            }

            let mut turn = 0;
            let max_turns = max_steps.max(1);

            while turn < max_turns {
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
                                                    let delta = first.get("delta").cloned().unwrap_or(json!({}));
                                                    if let Some(txt) = delta.get("content").and_then(|c| c.as_str()) {
                                                        if !txt.is_empty() {
                                                            assistant_text.push_str(txt);
                                                            let evt_json = json!({ "type": "delta", "delta": txt });
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

                        if !assistant_text.is_empty() && tool_calls.is_empty() {
                            messages.push(json!({
                                "role": "assistant",
                                "content": assistant_text
                            }));
                            let done_evt = json!({ "type": "delta", "delta": "" });
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

                                let start_summary = match fn_name {
                                    "beacon_create_endpoint" => {
                                        let ep_name = fn_args.get("name").and_then(|n| n.as_str()).unwrap_or("endpoint");
                                        format!("Creating endpoint '{}'", ep_name)
                                    }
                                    "beacon_update_endpoint" => {
                                        let ep_id = fn_args.get("id").and_then(|i| i.as_str()).unwrap_or("endpoint");
                                        format!("Updating endpoint '{}'", ep_id)
                                    }
                                    "beacon_delete_endpoint" => {
                                        let ep_id = fn_args.get("id").and_then(|i| i.as_str()).unwrap_or("endpoint");
                                        format!("Deleting endpoint '{}'", ep_id)
                                    }
                                    "beacon_run_collection" => "Running collection test sequence with variable chaining".to_string(),
                                    "beacon_run_load_test" => {
                                        let c = fn_args.get("concurrency").and_then(|v| v.as_u64()).unwrap_or(5);
                                        let n = fn_args.get("max_requests").and_then(|v| v.as_u64()).unwrap_or(50);
                                        format!("Running load test ({} workers, {} requests)", c, n)
                                    }
                                    "beacon_probe_endpoint" => "Probing endpoint".to_string(),
                                    "beacon_get_endpoint" => "Inspecting endpoint metadata".to_string(),
                                    "beacon_list_endpoints" => "Scanning project endpoints".to_string(),
                                    "beacon_set_variable" => {
                                        let k = fn_args.get("name").and_then(|v| v.as_str()).unwrap_or("variable");
                                        format!("Setting variable '{}'", k)
                                    }
                                    other => format!("Executing {}", other),
                                };

                                let start_evt = json!({
                                    "type": "tool_start",
                                    "call_id": call_id,
                                    "name": fn_name,
                                    "summary": start_summary,
                                    "arguments": fn_args
                                });
                                yield Ok(Event::default().data(serde_json::to_string(&start_evt).unwrap()));

                                let tool_res = execute_tool(fn_name, &fn_args, &*workspace).await;

                                let is_mutation = tool_res
                                    .get("mutated")
                                    .and_then(|m| m.as_bool())
                                    .unwrap_or(false);

                                let finish_summary = if let Some(sum) = tool_res.get("summary").and_then(|s| s.as_str()) {
                                    sum.to_string()
                                } else {
                                    format!("Executed {}", fn_name)
                                };

                                let finish_evt = json!({
                                    "type": "tool_result",
                                    "call_id": call_id,
                                    "name": fn_name,
                                    "ok": tool_res.get("error").is_none(),
                                    "mutated": is_mutation,
                                    "summary": finish_summary,
                                    "result": tool_res
                                });
                                yield Ok(Event::default().data(serde_json::to_string(&finish_evt).unwrap()));

                                if is_mutation {
                                    let ws_evt = json!({
                                        "type": "workspace_changed",
                                        "action": fn_name
                                    });
                                    yield Ok(Event::default().data(serde_json::to_string(&ws_evt).unwrap()));
                                }

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
                            "type": "error",
                            "error": {
                                "title": "Gateway Error",
                                "items": [{
                                    "provider": "gateway",
                                    "reason": format!("HTTP {}: {:?}", status.as_u16(), err_json.0)
                                }]
                            }
                        });
                        yield Ok(Event::default().data(serde_json::to_string(&err_evt).unwrap()));
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_includes_context_and_scope() {
        let ctx = json!({
            "projectName": "G-SPOT", "projectId": "p1", "baseUrl": "https://x",
            "preferences": { "scope": "workspace", "language": "id", "guides": ["summary-table"], "projectNotes": { "p1": "staging only" } }
        });
        let p = build_system_prompt(&ctx);
        assert!(p.contains("Active project: G-SPOT"));
        assert!(p.contains("WORKSPACE-LOCKED"));
        assert!(p.contains("reply in Indonesian"));
        assert!(p.contains("markdown summary table"));
        assert!(p.contains("staging only"));
        assert!(!build_system_prompt(&Value::Null).contains("LIVE WORKSPACE CONTEXT"));
    }
}
