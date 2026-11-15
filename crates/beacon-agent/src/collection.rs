//! Folder/tree operations on a project's collection (`items`), shared by the agent and MCP tools.
//! Pure functions over the JSON tree so they are testable without a store.
use serde_json::{json, Value};
use uuid::Uuid;

fn is_folder(n: &Value) -> bool {
    n["type"] == "folder"
}

fn matches(n: &Value, needle: &str) -> bool {
    n["id"].as_str() == Some(needle) || n["name"].as_str().is_some_and(|s| s.eq_ignore_ascii_case(needle))
}

/// Finds a folder by id, name, or "Parent/Child" path. Returns the index path into the tree.
fn find_folder(nodes: &[Value], needle: &str) -> Option<Vec<usize>> {
    let needle = needle.trim().trim_matches('/');
    if let Some((head, rest)) = needle.split_once('/') {
        let i = nodes.iter().position(|n| is_folder(n) && matches(n, head.trim()))?;
        let mut p = find_folder(nodes[i]["items"].as_array()?, rest)?;
        p.insert(0, i);
        return Some(p);
    }
    find_node(nodes, &|n| is_folder(n) && matches(n, needle))
}

fn find_node(nodes: &[Value], pred: &dyn Fn(&Value) -> bool) -> Option<Vec<usize>> {
    for (i, n) in nodes.iter().enumerate() {
        if pred(n) {
            return Some(vec![i]);
        }
        if let Some(kids) = n["items"].as_array() {
            if let Some(mut p) = find_node(kids, pred) {
                p.insert(0, i);
                return Some(p);
            }
        }
    }
    None
}

fn children_mut<'a>(root: &'a mut Vec<Value>, path: &[usize]) -> Option<&'a mut Vec<Value>> {
    let mut cur = root;
    for &i in path {
        cur = cur.get_mut(i)?.get_mut("items")?.as_array_mut()?;
    }
    Some(cur)
}

fn take(root: &mut Vec<Value>, path: &[usize]) -> Option<Value> {
    let (last, parent) = path.split_last()?;
    let list = children_mut(root, parent)?;
    (*last < list.len()).then(|| list.remove(*last))
}

/// Resolves a parent spec: null / "" / "/" / "root" means the top level.
fn parent_path(tree: &[Value], spec: Option<&str>) -> Result<Vec<usize>, String> {
    match spec.map(str::trim).filter(|s| !s.is_empty() && *s != "/" && !s.eq_ignore_ascii_case("root")) {
        None => Ok(vec![]),
        Some(f) => find_folder(tree, f).ok_or_else(|| format!("Folder '{f}' not found")),
    }
}

/// Appends already-materialized nodes (with ids) into the named folder (or top
/// level, via the same spec `parent_path` accepts). Used by collection import,
/// which has whole subtrees to place rather than single named items to `move`.
/// Returns `None` if the folder doesn't exist.
pub fn insert_into_folder(tree: &mut Vec<Value>, folder: &str, items: Vec<Value>) -> Option<()> {
    let path = parent_path(tree, Some(folder)).ok()?;
    let list = children_mut(tree, &path)?;
    list.extend(items);
    Some(())
}

/// Compact view for the model: folders with nested items, requests with method + url.
pub fn summarize(nodes: &[Value]) -> Vec<Value> {
    nodes
        .iter()
        .map(|n| {
            if is_folder(n) {
                json!({ "type": "folder", "id": n["id"], "name": n["name"], "items": summarize(n["items"].as_array().map(|v| v.as_slice()).unwrap_or(&[])) })
            } else {
                json!({ "type": "request", "id": n["id"], "name": n["name"], "method": n["method"], "url": n["url"] })
            }
        })
        .collect()
}

/// Applies one operation. Returns a short human description of what changed.
pub fn apply(tree: &mut Vec<Value>, op: &Value) -> Result<String, String> {
    let s = |k: &str| op.get(k).and_then(|v| v.as_str());
    match s("op").unwrap_or("") {
        "create_folder" => {
            let name = s("name").map(str::trim).filter(|n| !n.is_empty()).ok_or("create_folder needs 'name'")?;
            let parent = parent_path(tree, s("parent"))?;
            let list = children_mut(tree, &parent).ok_or("Invalid parent")?;
            // Idempotent: reuse a same-named sibling folder instead of duplicating.
            if list.iter().any(|n| is_folder(n) && matches(n, name)) {
                return Ok(format!("Folder '{name}' already exists"));
            }
            list.push(json!({ "id": Uuid::new_v4().to_string(), "name": name, "type": "folder", "items": [] }));
            Ok(format!("Created folder '{name}'"))
        }
        "rename_folder" => {
            let f = s("folder").ok_or("rename_folder needs 'folder'")?;
            let name = s("name").map(str::trim).filter(|n| !n.is_empty()).ok_or("rename_folder needs 'name'")?;
            let path = find_folder(tree, f).ok_or_else(|| format!("Folder '{f}' not found"))?;
            let (last, parent) = path.split_last().unwrap();
            children_mut(tree, parent).unwrap()[*last]["name"] = json!(name);
            Ok(format!("Renamed folder '{f}' to '{name}'"))
        }
        "delete_folder" => {
            let f = s("folder").ok_or("delete_folder needs 'folder'")?;
            let path = find_folder(tree, f).ok_or_else(|| format!("Folder '{f}' not found"))?;
            let folder = take(tree, &path).unwrap();
            let kids = folder["items"].as_array().cloned().unwrap_or_default();
            if op.get("delete_contents").and_then(|v| v.as_bool()).unwrap_or(false) {
                return Ok(format!("Deleted folder '{f}' and its {} item(s)", kids.len()));
            }
            // Default keeps the endpoints: they move up to where the folder was.
            let (last, parent) = path.split_last().unwrap();
            let list = children_mut(tree, parent).unwrap();
            let n = kids.len();
            for (j, k) in kids.into_iter().enumerate() {
                list.insert(last + j, k);
            }
            Ok(format!("Deleted folder '{f}', kept its {n} item(s) in its parent"))
        }
        "move" => {
            let names: Vec<String> = match op.get("items") {
                Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str().map(String::from)).collect(),
                Some(Value::String(one)) => vec![one.clone()],
                _ => return Err("move needs 'items' (ids or names)".into()),
            };
            let mut moved = Vec::new();
            for needle in &names {
                let path = find_node(tree, &|n| matches(n, needle)).ok_or_else(|| format!("Item '{needle}' not found"))?;
                moved.push(take(tree, &path).unwrap());
            }
            // Resolve the target after removal so indices are current.
            let target = match parent_path(tree, s("to")) {
                Ok(p) => p,
                Err(e) => {
                    tree.extend(moved); // never lose items on a bad target
                    return Err(e);
                }
            };
            let list = children_mut(tree, &target).ok_or("Invalid target")?;
            let at = op.get("index").and_then(|v| v.as_u64()).map(|i| (i as usize).min(list.len())).unwrap_or(list.len());
            let n = moved.len();
            for (j, m) in moved.into_iter().enumerate() {
                list.insert(at + j, m);
            }
            Ok(format!("Moved {n} item(s) to {}", s("to").filter(|t| !t.trim().is_empty()).unwrap_or("root")))
        }
        "reorder" => {
            let order: Vec<&str> = op.get("order").and_then(|v| v.as_array()).ok_or("reorder needs 'order'")?.iter().filter_map(|v| v.as_str()).collect();
            let parent = parent_path(tree, s("parent"))?;
            let list = children_mut(tree, &parent).ok_or("Invalid parent")?;
            let mut rest = std::mem::take(list);
            for needle in &order {
                if let Some(i) = rest.iter().position(|n| matches(n, needle)) {
                    list.push(rest.remove(i));
                }
            }
            list.extend(rest); // unlisted items keep their relative order after the listed ones
            Ok(format!("Reordered {} item(s)", order.len()))
        }
        other => Err(format!("Unknown op '{other}'. Use create_folder, rename_folder, delete_folder, move, or reorder")),
    }
}

fn count_requests(nodes: &[Value]) -> usize {
    nodes.iter().map(|n| if is_folder(n) { count_requests(n["items"].as_array().map(|v| v.as_slice()).unwrap_or(&[])) } else { 1 }).sum()
}

/// Applies all operations atomically: on any error the original tree is untouched.
pub fn apply_all(tree: &[Value], ops: &[Value]) -> Result<(Vec<Value>, Vec<String>), String> {
    let mut next = tree.to_vec();
    let before = count_requests(&next);
    let mut log = Vec::new();
    for (i, op) in ops.iter().enumerate() {
        log.push(apply(&mut next, op).map_err(|e| format!("Operation #{} failed: {e}", i + 1))?);
    }
    let deleting = ops.iter().any(|o| o["op"] == "delete_folder" && o["delete_contents"] == true);
    if !deleting && count_requests(&next) != before {
        return Err("Refusing to save: the operations would lose endpoints".into());
    }
    Ok((next, log))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(id: &str, name: &str) -> Value {
        json!({ "type": "request", "id": id, "name": name, "method": "GET", "url": "/x" })
    }

    #[test]
    fn organizes_endpoints_into_module_folders() {
        let tree = vec![req("a", "Add Discount"), req("b", "List Discount"), req("c", "Get Product")];
        let ops = json!([
            { "op": "create_folder", "name": "Discount" },
            { "op": "create_folder", "name": "Product" },
            { "op": "create_folder", "name": "Discount" },
            { "op": "move", "items": ["Add Discount", "b"], "to": "Discount" },
            { "op": "move", "items": ["c"], "to": "Product" },
            { "op": "reorder", "order": ["Product", "Discount"] },
            { "op": "create_folder", "name": "Admin", "parent": "Discount" },
            { "op": "move", "items": "b", "to": "Discount/Admin" }
        ]);
        let (t, log) = apply_all(&tree, ops.as_array().unwrap()).unwrap();
        assert_eq!(log[2], "Folder 'Discount' already exists");
        assert_eq!(t.len(), 2);
        assert_eq!(t[0]["name"], "Product");
        assert_eq!(t[1]["items"][0]["id"], "a");
        assert_eq!(t[1]["items"][1]["name"], "Admin");
        assert_eq!(t[1]["items"][1]["items"][0]["id"], "b");
    }

    #[test]
    fn delete_folder_keeps_contents_and_errors_roll_back() {
        let tree = vec![json!({ "type": "folder", "id": "f", "name": "Old", "items": [req("a", "A")] }), req("b", "B")];
        let (t, _) = apply_all(&tree, &[json!({ "op": "delete_folder", "folder": "Old" })]).unwrap();
        assert_eq!(t[0]["id"], "a");
        assert_eq!(t.len(), 2);
        // A bad op leaves the original tree untouched.
        let err = apply_all(&tree, &[json!({ "op": "create_folder", "name": "New" }), json!({ "op": "move", "items": ["zzz"], "to": "New" })]);
        assert!(err.unwrap_err().contains("#2"));
        let (gone, _) = apply_all(&tree, &[json!({ "op": "delete_folder", "folder": "f", "delete_contents": true })]).unwrap();
        assert_eq!(gone.len(), 1);
    }
}
