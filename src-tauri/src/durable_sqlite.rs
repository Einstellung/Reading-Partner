// SQLite under pi-durable's storage (docs/research/pi-durable-spike.md). The
// frontend's `SqliteDatabase` facade (src/platform/app/durable-sqlite.ts) is
// the only caller: it serializes every call per database and runs a
// transaction as `BEGIN IMMEDIATE`, statements, then `COMMIT` or `ROLLBACK`
// through `exec`, so this side only holds connections and runs one statement
// at a time on the one the handle names.
//
// Values cross the IPC as JSON. An integer outside JavaScript's safe range and
// a blob travel as tagged objects (`{"$bigint": "..."}`, `{"$blob": [..]}`);
// everything else is the plain JSON value.
//
// Paths are AppData-relative, like atomic_fs. The commands are async so they
// run on the async runtime rather than the main thread.

use rusqlite::types::{Value, ValueRef};
use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::{params_from_iter, Batch, Connection};
use serde_json::{Map, Number, Value as Json};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Open connections by the handle `durable_sqlite_open` returned.
#[derive(Default)]
pub struct DurableSqliteState {
    next: AtomicU32,
    connections: Mutex<HashMap<u32, Arc<Mutex<Connection>>>>,
}

const MAX_SAFE_INTEGER: i64 = (1 << 53) - 1;

fn sql_error(error: rusqlite::Error) -> String {
    error.to_string()
}

fn to_sql(value: &Json) -> Result<Value, String> {
    match value {
        Json::Null => Ok(Value::Null),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Ok(Value::Integer(i)),
            None => n.as_f64().map(Value::Real).ok_or_else(|| format!("unsupported number {n}")),
        },
        Json::String(s) => Ok(Value::Text(s.clone())),
        Json::Object(o) => {
            if let Some(Json::String(s)) = o.get("$bigint") {
                return s.parse::<i64>().map(Value::Integer).map_err(|e| e.to_string());
            }
            if let Some(Json::Array(bytes)) = o.get("$blob") {
                return bytes
                    .iter()
                    .map(|b| b.as_u64().filter(|b| *b < 256).map(|b| b as u8))
                    .collect::<Option<Vec<u8>>>()
                    .map(Value::Blob)
                    .ok_or_else(|| "blob bytes must be 0..=255".to_string());
            }
            Err("unsupported binding object".to_string())
        }
        other => Err(format!("unsupported binding {other}")),
    }
}

fn from_sql(value: ValueRef<'_>) -> Json {
    let tagged = |key: &str, inner: Json| {
        let mut map = Map::new();
        map.insert(key.to_string(), inner);
        Json::Object(map)
    };
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&i) => Json::Number(i.into()),
        ValueRef::Integer(i) => tagged("$bigint", Json::String(i.to_string())),
        ValueRef::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => tagged("$blob", Json::Array(b.iter().map(|x| Json::Number((*x).into())).collect())),
    }
}

fn bindings(params: &[Json]) -> Result<Vec<Value>, String> {
    params.iter().map(to_sql).collect()
}

fn connection(state: &DurableSqliteState, handle: u32) -> Result<Arc<Mutex<Connection>>, String> {
    state
        .connections
        .lock()
        .map_err(|_| "connection table poisoned".to_string())?
        .get(&handle)
        .cloned()
        .ok_or_else(|| format!("no open database {handle}"))
}

fn with_connection<T>(
    state: &DurableSqliteState,
    handle: u32,
    run: impl FnOnce(&Connection) -> rusqlite::Result<T>,
) -> Result<T, String> {
    let shared = connection(state, handle)?;
    let conn = shared.lock().map_err(|_| "connection poisoned".to_string())?;
    run(&conn).map_err(sql_error)
}

/// Rows of one statement as objects keyed by column name; `limit` stops early.
fn query(conn: &Connection, sql: &str, params: Vec<Value>, limit: Option<usize>) -> rusqlite::Result<Vec<Json>> {
    let mut statement = conn.prepare_cached(sql)?;
    let names: Vec<String> = statement.column_names().iter().map(|n| n.to_string()).collect();
    let mut rows = statement.query(params_from_iter(params))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            object.insert(name.clone(), from_sql(row.get_ref(index)?));
        }
        out.push(Json::Object(object));
        if limit.is_some_and(|l| out.len() >= l) {
            break;
        }
    }
    Ok(out)
}

/// Open (creating it and its directory) the database at an AppData-relative
/// path, in WAL mode with `synchronous = NORMAL`.
#[tauri::command]
pub async fn durable_sqlite_open(
    app: AppHandle,
    state: State<'_, DurableSqliteState>,
    path: String,
) -> Result<u32, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = crate::atomic_fs::safe_join(&root, &path)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&file).map_err(sql_error)?;
    conn.busy_timeout(Duration::from_millis(5000)).map_err(sql_error)?;
    conn.set_prepared_statement_cache_capacity(128);
    conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get::<_, String>(0))
        .map_err(sql_error)?;
    conn.execute_batch("PRAGMA synchronous = NORMAL").map_err(sql_error)?;
    let handle = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state
        .connections
        .lock()
        .map_err(|_| "connection table poisoned".to_string())?
        .insert(handle, Arc::new(Mutex::new(conn)));
    Ok(handle)
}

/// SQL text without bindings, possibly several statements; rows are discarded.
#[tauri::command]
pub async fn durable_sqlite_exec(state: State<'_, DurableSqliteState>, handle: u32, sql: String) -> Result<(), String> {
    with_connection(&state, handle, |conn| {
        let mut batch = Batch::new(conn, &sql);
        while let Some(mut statement) = batch.next()? {
            let mut rows = statement.raw_query();
            while rows.next()?.is_some() {}
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn durable_sqlite_run(
    state: State<'_, DurableSqliteState>,
    handle: u32,
    sql: String,
    params: Vec<Json>,
) -> Result<(), String> {
    let params = bindings(&params)?;
    with_connection(&state, handle, |conn| {
        let mut statement = conn.prepare_cached(&sql)?;
        let mut rows = statement.query(params_from_iter(params))?;
        while rows.next()?.is_some() {}
        Ok(())
    })
}

#[tauri::command]
pub async fn durable_sqlite_get(
    state: State<'_, DurableSqliteState>,
    handle: u32,
    sql: String,
    params: Vec<Json>,
) -> Result<Option<Json>, String> {
    let params = bindings(&params)?;
    with_connection(&state, handle, |conn| Ok(query(conn, &sql, params, Some(1))?.pop()))
}

#[tauri::command]
pub async fn durable_sqlite_all(
    state: State<'_, DurableSqliteState>,
    handle: u32,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Json>, String> {
    let params = bindings(&params)?;
    with_connection(&state, handle, |conn| query(conn, &sql, params, None))
}

/// Checkpoint the WAL into the database file and close. Closing a handle that
/// is not open is not an error.
#[tauri::command]
pub async fn durable_sqlite_close(state: State<'_, DurableSqliteState>, handle: u32) -> Result<(), String> {
    let removed = state
        .connections
        .lock()
        .map_err(|_| "connection table poisoned".to_string())?
        .remove(&handle);
    let Some(shared) = removed else { return Ok(()) };
    let conn = shared.lock().map_err(|_| "connection poisoned".to_string())?;
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .map_err(sql_error)?;
    Ok(())
}

/// Delete a closed database with its `-wal` and `-shm` files. Missing files are
/// not an error.
#[tauri::command]
pub async fn durable_sqlite_remove(app: AppHandle, path: String) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = crate::atomic_fs::safe_join(&root, &path)?;
    for suffix in ["", "-wal", "-shm"] {
        let mut target = file.clone().into_os_string();
        target.push(suffix);
        match std::fs::remove_file(&target) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

/// Bytes of a database file and its `-wal`, open or closed; missing files count
/// as zero. The generation swap reads it after every turn.
#[tauri::command]
pub async fn durable_sqlite_size(app: AppHandle, path: String) -> Result<u64, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = crate::atomic_fs::safe_join(&root, &path)?;
    let mut total = 0;
    for suffix in ["", "-wal"] {
        let mut target = file.clone().into_os_string();
        target.push(suffix);
        match std::fs::metadata(&target) {
            Ok(meta) => total += meta.len(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_round_trip_through_json() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (i INTEGER, r REAL, s TEXT, b BLOB) STRICT").unwrap();
        let params = bindings(&serde_json::from_str::<Vec<Json>>(
            r#"[{"$bigint":"9007199254740993"}, 1.5, "x", {"$blob":[1,2,255]}]"#,
        ).unwrap())
        .unwrap();
        conn.execute("INSERT INTO t VALUES (?, ?, ?, ?)", params_from_iter(params)).unwrap();
        conn.execute("INSERT INTO t VALUES (7, NULL, NULL, NULL)", []).unwrap();
        let rows = query(&conn, "SELECT * FROM t", vec![], None).unwrap();
        assert_eq!(
            serde_json::to_string(&rows).unwrap(),
            r#"[{"b":{"$blob":[1,2,255]},"i":{"$bigint":"9007199254740993"},"r":1.5,"s":"x"},{"b":null,"i":7,"r":null,"s":null}]"#
        );
    }
}
