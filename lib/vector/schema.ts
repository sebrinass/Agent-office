/**
 * 数据库表结构定义模块
 * 
 * 定义向量数据库的表结构：
 * - edit_records: 编辑记录表
 * - documents: 文档信息表
 * - vectors: 向量索引表
 * 
 * 注意：sql.js 不支持 FTS5 扩展，全文检索使用 LIKE 实现
 */

import { sqliteConnection } from './sqlite-connection';

// ============ 类型定义 ============

export interface EditRecord {
  id: string;
  document_id: string;
  operation_type: 'insert' | 'delete' | 'replace' | 'format';
  position_start: number;
  position_end: number;
  old_content: string | null;
  new_content: string | null;
  agent_id: string | null;
  timestamp: number;
  metadata: string | null; // JSON 字符串
}

export interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  created_at: number;
  updated_at: number;
  content_hash: string | null;
  metadata: string | null; // JSON 字符串
}

export interface VectorRecord {
  id: string;
  source_type: 'edit_record' | 'document' | 'custom';
  source_id: string;
  content: string;
  embedding: string; // JSON 数组字符串
  embedding_model: string;
  embedding_dims: number;
  created_at: number;
}

export interface SchemaVersion {
  version: number;
  applied_at: number;
}

// ============ Schema 版本管理 ============

const SCHEMA_VERSION = 1;

/**
 * 获取当前 schema 版本
 */
function getSchemaVersion(): number {
  try {
    const result = sqliteConnection.query<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    );
    return result.length > 0 ? result[0].version : 0;
  } catch {
    return 0;
  }
}

/**
 * 记录 schema 版本
 */
function setSchemaVersion(version: number): void {
  sqliteConnection.run(
    'INSERT INTO schema_version (version, applied_at) VALUES ($1, $2)',
    [version, Date.now()]
  );
}

// ============ 表结构创建 ============

/**
 * 创建 schema_version 表
 */
function createSchemaVersionTable(): void {
  sqliteConnection.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);
}

/**
 * 创建编辑记录表
 */
function createEditRecordsTable(): void {
  sqliteConnection.exec(`
    CREATE TABLE IF NOT EXISTS edit_records (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      operation_type TEXT NOT NULL CHECK(operation_type IN ('insert', 'delete', 'replace', 'format')),
      position_start INTEGER NOT NULL,
      position_end INTEGER NOT NULL,
      old_content TEXT,
      new_content TEXT,
      agent_id TEXT,
      timestamp INTEGER NOT NULL,
      metadata TEXT
    )
  `);
  
  // 创建索引
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_edit_records_document_id ON edit_records(document_id)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_edit_records_timestamp ON edit_records(timestamp)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_edit_records_agent_id ON edit_records(agent_id)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_edit_records_operation_type ON edit_records(operation_type)
  `);
}

/**
 * 创建文档信息表
 */
function createDocumentsTable(): void {
  sqliteConnection.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      content_hash TEXT,
      metadata TEXT
    )
  `);
  
  // 创建索引
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at)
  `);
}

/**
 * 创建向量索引表
 */
function createVectorsTable(): void {
  sqliteConnection.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK(source_type IN ('edit_record', 'document', 'custom')),
      source_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding_dims INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  
  // 创建索引
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_vectors_source_type ON vectors(source_type)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_vectors_source_id ON vectors(source_id)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_vectors_embedding_model ON vectors(embedding_model)
  `);
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_vectors_created_at ON vectors(created_at)
  `);
}

/**
 * 创建全文搜索辅助表
 * 由于 sql.js 不支持 FTS5，使用普通表 + LIKE 查询
 */
function createFullTextSearchTable(): void {
  // 创建一个用于全文搜索的聚合视图（通过 UNION）
  // 实际搜索时使用 LIKE 或自定义分词
  sqliteConnection.exec(`
    CREATE TABLE IF NOT EXISTS search_index (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  
  sqliteConnection.exec(`
    CREATE INDEX IF NOT EXISTS idx_search_index_source_type ON search_index(source_type)
  `);
}

// ============ 主初始化函数 ============

/**
 * 初始化数据库表结构
 */
export async function initializeSchema(): Promise<{ 
  success: boolean; 
  version: number; 
  migrations: string[] 
}> {
  const migrations: string[] = [];
  
  try {
    // 创建版本管理表
    createSchemaVersionTable();
    
    const currentVersion = getSchemaVersion();
    
    // 根据版本执行迁移
    if (currentVersion < 1) {
      createEditRecordsTable();
      createDocumentsTable();
      createVectorsTable();
      createFullTextSearchTable();
      setSchemaVersion(1);
      migrations.push('v1: 初始表结构创建');
    }
    
    return {
      success: true,
      version: SCHEMA_VERSION,
      migrations,
    };
  } catch (err) {
    throw new Error(`Failed to initialize schema: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 检查表是否存在
 */
export function tableExists(tableName: string): boolean {
  const result = sqliteConnection.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=$1",
    [tableName]
  );
  return result.length > 0;
}

/**
 * 获取所有表名
 */
export function getAllTables(): string[] {
  const result = sqliteConnection.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  return result.map(r => r.name);
}

/**
 * 获取表结构信息
 */
export function getTableSchema(tableName: string): { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[] {
  return sqliteConnection.query(
    `PRAGMA table_info(${tableName})`
  );
}

/**
 * 清空所有数据（保留表结构）
 */
export function clearAllData(): void {
  sqliteConnection.exec('DELETE FROM search_index');
  sqliteConnection.exec('DELETE FROM vectors');
  sqliteConnection.exec('DELETE FROM edit_records');
  sqliteConnection.exec('DELETE FROM documents');
}

/**
 * 删除所有表（危险操作）
 */
export function dropAllTables(): void {
  const tables = getAllTables();
  for (const table of tables) {
    sqliteConnection.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}
