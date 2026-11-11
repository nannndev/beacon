use beacon_core::{EndpointTest, TestConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Environment {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub variables: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub environments: Vec<Environment>,
    #[serde(default)]
    pub current_environment_id: Option<String>,
    #[serde(default)]
    pub notifications: Option<Value>,
    #[serde(default)]
    pub shared_origin: Option<Value>,
    #[serde(default)]
    pub file_sync: Option<Value>,
    #[serde(default)]
    pub items: Option<Vec<Value>>,
    #[serde(default)]
    pub tests: Option<Vec<Value>>,
    #[serde(default)]
    pub auth: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedData {
    pub current_project_id: Option<String>,
    pub projects: Vec<Project>,
    #[serde(default)]
    pub global_variables: HashMap<String, Value>,
}

#[derive(Debug)]
pub struct Store {
    pub file_path: PathBuf,
    pub projects: Vec<Project>,
    pub current_project_id: Option<String>,
    pub global_variables: HashMap<String, Value>,
    pub current_config: TestConfig,
}

impl Store {
    pub fn new() -> Self {
        let path = if let Ok(dir) = std::env::var("BEACON_DATA_DIR") {
            PathBuf::from(dir).join("tests.json")
        } else {
            PathBuf::from("config").join("tests.json")
        };
        let mut store = Self {
            file_path: path,
            projects: Vec::new(),
            current_project_id: None,
            global_variables: HashMap::new(),
            current_config: TestConfig::new(String::new(), HashMap::new(), Vec::new()),
        };
        store.load();
        store
    }

    pub fn load(&mut self) {
        if self.file_path.exists() {
            if let Ok(content) = fs::read_to_string(&self.file_path) {
                if let Ok(data) = serde_json::from_str::<PersistedData>(&content) {
                    self.projects = data.projects;
                    self.current_project_id = data.current_project_id;
                    self.global_variables = data.global_variables;
                }
            }
        }

        if self.projects.is_empty() {
            let pid = Uuid::new_v4().to_string();
            let env_id = Uuid::new_v4().to_string();
            let default_env = Environment {
                id: env_id.clone(),
                name: "Default".into(),
                base_url: "https://jsonplaceholder.typicode.com".into(),
                variables: HashMap::new(),
            };
            let default_project = Project {
                id: pid.clone(),
                name: "Default Project".into(),
                template_id: Some("jsonplaceholder-v1".into()),
                environments: vec![default_env],
                current_environment_id: Some(env_id),
                notifications: None,
                shared_origin: None,
                file_sync: None,
                items: Some(Vec::new()),
                tests: None,
                auth: None,
            };
            self.projects.push(default_project);
            self.current_project_id = Some(pid);
        }

        self.sync_current_config();
    }

    pub fn get_active_project(&self) -> Option<&Project> {
        if let Some(ref pid) = self.current_project_id {
            if let Some(p) = self.projects.iter().find(|p| p.id == *pid) {
                return Some(p);
            }
        }
        self.projects.first()
    }

    pub fn get_active_project_mut(&mut self) -> Option<&mut Project> {
        let pid = self.current_project_id.clone();
        if let Some(ref id) = pid {
            if let Some(idx) = self.projects.iter().position(|p| p.id == *id) {
                return Some(&mut self.projects[idx]);
            }
        }
        self.projects.first_mut()
    }

    pub fn get_active_env<'a>(project: &'a Project) -> Option<&'a Environment> {
        if let Some(ref env_id) = project.current_environment_id {
            if let Some(env) = project.environments.iter().find(|e| e.id == *env_id) {
                return Some(env);
            }
        }
        project.environments.first()
    }

    pub fn sync_current_config(&mut self) {
        if self.projects.is_empty() {
            return;
        }

        let pid = if let Some(ref id) = self.current_project_id {
            id.clone()
        } else {
            let id = self.projects[0].id.clone();
            self.current_project_id = Some(id.clone());
            id
        };

        let proj = self.projects.iter().find(|p| p.id == pid).unwrap_or(&self.projects[0]);
        let env = Self::get_active_env(proj);

        let mut effective_vars: HashMap<String, String> = HashMap::new();
        for (k, v) in &self.global_variables {
            effective_vars.insert(
                k.clone(),
                match v {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                },
            );
        }
        let base_url = if let Some(e) = env {
            for (k, v) in &e.variables {
                effective_vars.insert(
                    k.clone(),
                    match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    },
                );
            }
            e.base_url.clone()
        } else {
            String::new()
        };

        let mut tests_data: Vec<Value> = Vec::new();
        if let Some(ref items) = proj.items {
            Self::flatten_items(items, proj.auth.as_ref(), &mut tests_data);
        } else if let Some(ref tests) = proj.tests {
            for t in tests {
                let mut test_val = t.clone();
                if let Some(ref auth) = proj.auth {
                    test_val["_inherited_auth"] = json!([auth]);
                }
                tests_data.push(test_val);
            }
        }

        let mut parsed_tests: Vec<EndpointTest> = Vec::new();
        for val in tests_data {
            let mut val_clean = val.clone();
            let inherited = val_clean.as_object_mut().and_then(|o| o.remove("_inherited_auth"));
            if let Ok(mut endpoint) = serde_json::from_value::<EndpointTest>(val_clean) {
                if let Some(Value::Array(auth_list)) = inherited {
                    endpoint.inherited_auth = auth_list;
                }
                parsed_tests.push(endpoint);
            }
        }

        self.current_config = TestConfig::new(base_url, effective_vars, parsed_tests);
    }

    fn flatten_items(nodes: &[Value], project_auth: Option<&Value>, out: &mut Vec<Value>) {
        fn walk(nodes: &[Value], inherited: &[Value], out: &mut Vec<Value>) {
            for node in nodes {
                if let Some(obj) = node.as_object() {
                    let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if node_type == "request" {
                        let mut item = node.clone();
                        item["_inherited_auth"] = json!(inherited);
                        out.push(item);
                    } else if node_type == "folder" || obj.contains_key("items") {
                        let mut next_inherited = inherited.to_vec();
                        if let Some(auth) = obj.get("auth") {
                            if !auth.is_null() {
                                next_inherited.push(auth.clone());
                            }
                        }
                        if let Some(items) = obj.get("items").and_then(|i| i.as_array()) {
                            walk(items, &next_inherited, out);
                        }
                    } else if let Some(tests) = obj.get("tests").and_then(|t| t.as_array()) {
                        for t in tests {
                            let mut item = t.clone();
                            item["_inherited_auth"] = json!(inherited);
                            out.push(item);
                        }
                    }
                }
            }
        }

        let init_inherited: Vec<Value> = project_auth.cloned().into_iter().collect();
        walk(nodes, &init_inherited, out);
    }

    pub fn save_active_project(&mut self) {
        let pid = match self.current_project_id {
            Some(ref id) => id.clone(),
            None => return,
        };

        let current_config_base = self.current_config.base_url.clone();
        let current_config_vars = self.current_config.variables.read().clone();
        let current_tests = self.current_config.tests.clone();

        if let Some(proj) = self.projects.iter_mut().find(|p| p.id == pid) {
            let active_env_id = proj.current_environment_id.clone();
            if let Some(ref env_id) = active_env_id {
                if let Some(env) = proj.environments.iter_mut().find(|e| e.id == *env_id) {
                    env.base_url = current_config_base;
                    // Only save non-global variables in the env
                    let mut env_vars = HashMap::new();
                    for (k, v) in current_config_vars {
                        if !self.global_variables.contains_key(&k) {
                            env_vars.insert(k, Value::String(v));
                        }
                    }
                    env.variables = env_vars;
                }
            }

            let new_tests_val: Vec<Value> = current_tests
                .iter()
                .filter_map(|t| serde_json::to_value(t).ok())
                .collect();

            if let Some(ref items) = proj.items {
                let reconciled = Self::reconcile_items(items, &new_tests_val);
                proj.items = Some(reconciled);
                proj.tests = None;
            } else {
                proj.tests = Some(new_tests_val);
            }
        }
    }

    fn reconcile_items(items: &[Value], tests: &[Value]) -> Vec<Value> {
        let mut by_id: HashMap<String, Value> = HashMap::new();
        for t in tests {
            if let Some(id) = t.get("id").and_then(|i| i.as_str()) {
                by_id.insert(id.to_string(), t.clone());
            }
        }

        let mut seen = HashSet::new();

        fn walk(nodes: &[Value], by_id: &HashMap<String, Value>, seen: &mut HashSet<String>) -> Vec<Value> {
            let mut result = Vec::new();
            for node in nodes {
                if let Some(obj) = node.as_object() {
                    let node_type = obj.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if node_type == "folder" {
                        let mut folder = node.clone();
                        let sub_items = obj.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
                        folder["items"] = Value::Array(walk(&sub_items, by_id, seen));
                        result.push(folder);
                    } else if let Some(id) = obj.get("id").and_then(|i| i.as_str()) {
                        if let Some(updated) = by_id.get(id) {
                            let mut req = updated.clone();
                            req["type"] = json!("request");
                            result.push(req);
                            seen.insert(id.to_string());
                        }
                    }
                }
            }
            result
        }

        let mut new_items = walk(items, &by_id, &mut seen);
        for t in tests {
            if let Some(id) = t.get("id").and_then(|i| i.as_str()) {
                if !seen.contains(id) {
                    let mut req = t.clone();
                    req["type"] = json!("request");
                    new_items.push(req);
                }
            }
        }
        new_items
    }

    pub fn save(&mut self) -> Result<(), String> {
        self.save_active_project();

        let persisted = PersistedData {
            current_project_id: self.current_project_id.clone(),
            projects: self.projects.clone(),
            global_variables: self.global_variables.clone(),
        };

        let json_str = serde_json::to_string_pretty(&persisted)
            .map_err(|e| format!("Failed to serialize data: {}", e))?;

        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        let tmp_path = self.file_path.with_extension("tmp");
        fs::write(&tmp_path, json_str)
            .map_err(|e| format!("Failed to write tmp file: {}", e))?;
        fs::rename(&tmp_path, &self.file_path)
            .map_err(|e| format!("Failed to rename tmp file: {}", e))?;

        Ok(())
    }
}
