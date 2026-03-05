/**
 * 向量存储模块
 * 
 * 提供编辑记录、文档信息、向量数据的读写接口
 */

import { sqliteConnection, persistDatabase } from './sqlite-connection';
import type { EditRecord, Document, VectorRecord } from './schema';

// ============ 类型定义 ============

export interface WriteEditRecordInput {
  id: string;
  document_id: string;
  operation_type: 'insert' | 'delete' | 'replace' | 'format';
  position_start: number;
  position_end: number;
  old_content?: string | null;
  new_content?: string | null;
  agent_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WriteDocumentInput {
  id: string;
  filename: string;
  file_type: string;
  file_size?: number;
  content_hash?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WriteVectorInput {
  id: string;
  source_type: 'edit_record' | 'document' | 'custom';
  source_id: string;
  content: string;
  embedding: number[];
  embedding_model: string;
  embedding_dims: number;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'created_at' | 'updated_at';
  orderDirection?: 'ASC' | 'DESC';
}

export interface EditRecordQueryOptions extends QueryOptions {
  document_id?: string;
  agent_id?: string;
  operation_type?: string;
  startTime?: number;
  endTime?: number;
}

export interface DocumentQueryOptions extends QueryOptions {
  filename?: string;
  file_type?: string;
}

export interface VectorQueryOptions extends QueryOptions {
  source_type?: string;
  source_id?: string;
  embedding_model?: string;
}

// ============ 工具函数 ============

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 安全序列化 JSON
 */
function safeJsonStringify(data: unknown): string | null {
  if (data === null || data === undefined) return null;
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

/**
 * 安全解析 JSON
 */
function safeJsonParse<T>(str: string | null): T | null {
  if (!str) return null;
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

// ============ 编辑记录写入接口 ============

/**
 * 写入编辑记录
 */
export async function writeEditRecord(input: WriteEditRecordInput): Promise<EditRecord> {
  const record: EditRecord = {
    id: input.id || generateId(),
    document_id: input.document_id,
    operation_type: input.operation_type,
    position_start: input.position_start,
    position_end: input.position_end,
    old_content: input.old_content || null,
    new_content: input.new_content || null,
    agent_id: input.agent_id || null,
    timestamp: Date.now(),
    metadata: safeJsonStringify(input.metadata),
  };

  sqliteConnection.run(
    `INSERT INTO edit_records (
      id, document_id, operation_type, position_start, position_end,
      old_content, new_content, agent_id, timestamp, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      record.id,
      record.document_id,
      record.operation_type,
      record.position_start,
      record.position_end,
      record.old_content,
      record.new_content,
      record.agent_id,
      record.timestamp,
      record.metadata,
    ]
  );

  // 同时写入搜索索引
  if (record.new_content) {
    sqliteConnection.run(
      `INSERT OR REPLACE INTO search_index (id, source_type, source_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [`edit-${record.id}`, 'edit_record', record.id, record.new_content, record.timestamp]
    );
  }

  await persistDatabase();
  return record;
}

/**
 * 批量写入编辑记录
 */
export async function writeEditRecords(inputs: WriteEditRecordInput[]): Promise<EditRecord[]> {
  const records: EditRecord[] = [];
  
  for (const input of inputs) {
    const record = await writeEditRecord(input);
    records.push(record);
  }
  
  return records;
}

// ============ 文档信息写入接口 ============

/**
 * 写入文档信息
 */
export async function writeDocument(input: WriteDocumentInput): Promise<Document> {
  const now = Date.now();
  const document: Document = {
    id: input.id || generateId(),
    filename: input.filename,
    file_type: input.file_type,
    file_size: input.file_size || 0,
    created_at: now,
    updated_at: now,
    content_hash: input.content_hash || null,
    metadata: safeJsonStringify(input.metadata),
  };

  // 检查是否已存在
  const existing = sqliteConnection.query<{ id: string }>(
    'SELECT id FROM documents WHERE id = $1',
    [document.id]
  );

  if (existing.length > 0) {
    // 更新现有记录
    sqliteConnection.run(
      `UPDATE documents SET
        filename = $1, file_type = $2, file_size = $3,
        updated_at = $4, content_hash = $5, metadata = $6
       WHERE id = $7`,
      [
        document.filename,
        document.file_type,
        document.file_size,
        now,
        document.content_hash,
        document.metadata,
        document.id,
      ]
    );
    document.created_at = (await getDocumentById(document.id))?.created_at || now;
  } else {
    // 插入新记录
    sqliteConnection.run(
      `INSERT INTO documents (
        id, filename, file_type, file_size, created_at, updated_at, content_hash, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        document.id,
        document.filename,
        document.file_type,
        document.file_size,
        document.created_at,
        document.updated_at,
        document.content_hash,
        document.metadata,
      ]
    );
  }

  await persistDatabase();
  return document;
}

/**
 * 更新文档信息
 */
export async function updateDocument(id: string, updates: Partial<Omit<WriteDocumentInput, 'id'>>): Promise<Document | null> {
  const existing = await getDocumentById(id);
  if (!existing) return null;

  const now = Date.now();
  const updatesList: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.filename !== undefined) {
    updatesList.push('filename = $' + (values.length + 1));
    values.push(updates.filename);
  }
  if (updates.file_type !== undefined) {
    updatesList.push('file_type = $' + (values.length + 1));
    values.push(updates.file_type);
  }
  if (updates.file_size !== undefined) {
    updatesList.push('file_size = $' + (values.length + 1));
    values.push(updates.file_size);
  }
  if (updates.content_hash !== undefined) {
    updatesList.push('content_hash = $' + (values.length + 1));
    values.push(updates.content_hash);
  }
  if (updates.metadata !== undefined) {
    updatesList.push('metadata = $' + (values.length + 1));
    values.push(safeJsonStringify(updates.metadata));
  }

  updatesList.push('updated_at = $' + (values.length + 1));
  values.push(now);

  values.push(id);

  sqliteConnection.run(
    `UPDATE documents SET ${updatesList.join(', ')} WHERE id = $${values.length}`,
    values
  );

  await persistDatabase();
  return getDocumentById(id);
}

// ============ 向量数据写入接口 ============

/**
 * 写入向量数据
 */
export async function writeVector(input: WriteVectorInput): Promise<VectorRecord> {
  const record: VectorRecord = {
    id: input.id || generateId(),
    source_type: input.source_type,
    source_id: input.source_id,
    content: input.content,
    embedding: JSON.stringify(input.embedding),
    embedding_model: input.embedding_model,
    embedding_dims: input.embedding_dims,
    created_at: Date.now(),
  };

  sqliteConnection.run(
    `INSERT INTO vectors (
      id, source_type, source_id, content, embedding, embedding_model, embedding_dims, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.source_type,
      record.source_id,
      record.content,
      record.embedding,
      record.embedding_model,
      record.embedding_dims,
      record.created_at,
    ]
  );

  // 同时写入搜索索引
  sqliteConnection.run(
    `INSERT OR REPLACE INTO search_index (id, source_type, source_id, content, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [`vector-${record.id}`, record.source_type, record.source_id, record.content, record.created_at]
  );

  await persistDatabase();
  return record;
}

/**
 * 批量写入向量数据
 */
export async function writeVectors(inputs: WriteVectorInput[]): Promise<VectorRecord[]> {
  const records: VectorRecord[] = [];
  
  for (const input of inputs) {
    const record = await writeVector(input);
    records.push(record);
  }
  
  return records;
}

/**
 * 删除向量数据
 */
export async function deleteVector(id: string): Promise<boolean> {
  const result = sqliteConnection.run('DELETE FROM vectors WHERE id = $1', [id]);
  
  if (result.changes > 0) {
    sqliteConnection.run('DELETE FROM search_index WHERE id = $1', [`vector-${id}`]);
    await persistDatabase();
    return true;
  }
  
  return false;
}

// ============ 编辑记录读取接口 ============

/**
 * 按时间范围读取编辑记录
 */
export async function getEditRecordsByTimeRange(
  startTime: number,
  endTime: number,
  options?: QueryOptions
): Promise<EditRecord[]> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const orderDirection = options?.orderDirection || 'DESC';

  return sqliteConnection.query<EditRecord>(
    `SELECT * FROM edit_records 
     WHERE timestamp >= $1 AND timestamp <= $2 
     ORDER BY timestamp ${orderDirection}
     LIMIT $3 OFFSET $4`,
    [startTime, endTime, limit, offset]
  );
}

/**
 * 按文档 ID 读取编辑记录
 */
export async function getEditRecordsByDocumentId(
  documentId: string,
  options?: QueryOptions
): Promise<EditRecord[]> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const orderDirection = options?.orderDirection || 'DESC';

  return sqliteConnection.query<EditRecord>(
    `SELECT * FROM edit_records 
     WHERE document_id = $1 
     ORDER BY timestamp ${orderDirection}
     LIMIT $2 OFFSET $3`,
    [documentId, limit, offset]
  );
}

/**
 * 按类型筛选编辑记录
 */
export async function getEditRecordsByType(
  operationType: string,
  options?: QueryOptions
): Promise<EditRecord[]> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const orderDirection = options?.orderDirection || 'DESC';

  return sqliteConnection.query<EditRecord>(
    `SELECT * FROM edit_records 
     WHERE operation_type = $1 
     ORDER BY timestamp ${orderDirection}
     LIMIT $2 OFFSET $3`,
    [operationType, limit, offset]
  );
}

/**
 * 综合查询编辑记录
 */
export async function queryEditRecords(options: EditRecordQueryOptions): Promise<EditRecord[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  
  if (options.document_id) {
    conditions.push(`document_id = $${params.length + 1}`);
    params.push(options.document_id);
  }
  
  if (options.agent_id) {
    conditions.push(`agent_id = $${params.length + 1}`);
    params.push(options.agent_id);
  }
  
  if (options.operation_type) {
    conditions.push(`operation_type = $${params.length + 1}`);
    params.push(options.operation_type);
  }
  
  if (options.startTime !== undefined) {
    conditions.push(`timestamp >= $${params.length + 1}`);
    params.push(options.startTime);
  }
  
  if (options.endTime !== undefined) {
    conditions.push(`timestamp <= $${params.length + 1}`);
    params.push(options.endTime);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 100;
  const offset = options.offset || 0;
  const orderDirection = options.orderDirection || 'DESC';
  const orderBy = options.orderBy || 'timestamp';

  return sqliteConnection.query<EditRecord>(
    `SELECT * FROM edit_records ${whereClause} 
     ORDER BY ${orderBy} ${orderDirection}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
}

/**
 * 按 ID 获取编辑记录
 */
export async function getEditRecordById(id: string): Promise<EditRecord | null> {
  const result = sqliteConnection.query<EditRecord>(
    'SELECT * FROM edit_records WHERE id = $1',
    [id]
  );
  return result.length > 0 ? result[0] : null;
}

// ============ 文档信息读取接口 ============

/**
 * 按 ID 获取文档
 */
export async function getDocumentById(id: string): Promise<Document | null> {
  const result = sqliteConnection.query<Document>(
    'SELECT * FROM documents WHERE id = $1',
    [id]
  );
  return result.length > 0 ? result[0] : null;
}

/**
 * 按文件名获取文档
 */
export async function getDocumentByFilename(filename: string): Promise<Document | null> {
  const result = sqliteConnection.query<Document>(
    'SELECT * FROM documents WHERE filename = $1 LIMIT 1',
    [filename]
  );
  return result.length > 0 ? result[0] : null;
}

/**
 * 获取所有文档
 */
export async function getAllDocuments(options?: DocumentQueryOptions): Promise<Document[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  
  if (options?.filename) {
    conditions.push(`filename LIKE $${params.length + 1}`);
    params.push(`%${options.filename}%`);
  }
  
  if (options?.file_type) {
    conditions.push(`file_type = $${params.length + 1}`);
    params.push(options.file_type);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const orderDirection = options?.orderDirection || 'DESC';
  const orderBy = options?.orderBy || 'updated_at';

  return sqliteConnection.query<Document>(
    `SELECT * FROM documents ${whereClause} 
     ORDER BY ${orderBy} ${orderDirection}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
}

// ============ 向量数据读取接口 ============

/**
 * 按 ID 获取向量
 */
export async function getVectorById(id: string): Promise<(VectorRecord & { embedding_array: number[] }) | null> {
  const result = sqliteConnection.query<VectorRecord>(
    'SELECT * FROM vectors WHERE id = $1',
    [id]
  );
  
  if (result.length === 0) return null;
  
  const record = result[0];
  return {
    ...record,
    embedding_array: safeJsonParse<number[]>(record.embedding) || [],
  };
}

/**
 * 按来源获取向量
 */
export async function getVectorsBySource(
  sourceType: string,
  sourceId: string,
  options?: QueryOptions
): Promise<(VectorRecord & { embedding_array: number[] })[]> {
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;
  const orderDirection = options?.orderDirection || 'DESC';

  const result = sqliteConnection.query<VectorRecord>(
    `SELECT * FROM vectors 
     WHERE source_type = $1 AND source_id = $2 
     ORDER BY created_at ${orderDirection}
     LIMIT $3 OFFSET $4`,
    [sourceType, sourceId, limit, offset]
  );

  return result.map(r => ({
    ...r,
    embedding_array: safeJsonParse<number[]>(r.embedding) || [],
  }));
}

/**
 * 综合查询向量
 */
export async function queryVectors(options: VectorQueryOptions): Promise<(VectorRecord & { embedding_array: number[] })[]> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  
  if (options.source_type) {
    conditions.push(`source_type = $${params.length + 1}`);
    params.push(options.source_type);
  }
  
  if (options.source_id) {
    conditions.push(`source_id = $${params.length + 1}`);
    params.push(options.source_id);
  }
  
  if (options.embedding_model) {
    conditions.push(`embedding_model = $${params.length + 1}`);
    params.push(options.embedding_model);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 100;
  const offset = options.offset || 0;
  const orderDirection = options.orderDirection || 'DESC';
  const orderBy = options.orderBy || 'created_at';

  const result = sqliteConnection.query<VectorRecord>(
    `SELECT * FROM vectors ${whereClause} 
     ORDER BY ${orderBy} ${orderDirection}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return result.map(r => ({
    ...r,
    embedding_array: safeJsonParse<number[]>(r.embedding) || [],
  }));
}

/**
 * 获取所有向量（用于相似度计算）
 */
export async function getAllVectors(limit?: number): Promise<(VectorRecord & { embedding_array: number[] })[]> {
  const result = sqliteConnection.query<VectorRecord>(
    `SELECT * FROM vectors ORDER BY created_at DESC LIMIT $1`,
    [limit || 1000]
  );

  return result.map(r => ({
    ...r,
    embedding_array: safeJsonParse<number[]>(r.embedding) || [],
  }));
}

// ============ 统计接口 ============

/**
 * 获取编辑记录统计
 */
export async function getEditRecordStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  byDocument: { document_id: string; count: number }[];
}> {
  const totalResult = sqliteConnection.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM edit_records'
  );
  
  const byTypeResult = sqliteConnection.query<{ operation_type: string; count: number }>(
    'SELECT operation_type, COUNT(*) as count FROM edit_records GROUP BY operation_type'
  );
  
  const byDocumentResult = sqliteConnection.query<{ document_id: string; count: number }>(
    'SELECT document_id, COUNT(*) as count FROM edit_records GROUP BY document_id ORDER BY count DESC LIMIT 10'
  );

  return {
    total: totalResult[0]?.count || 0,
    byType: Object.fromEntries(byTypeResult.map(r => [r.operation_type, r.count])),
    byDocument: byDocumentResult,
  };
}

/**
 * 获取向量统计
 */
export async function getVectorStats(): Promise<{
  total: number;
  byModel: Record<string, number>;
  bySourceType: Record<string, number>;
}> {
  const totalResult = sqliteConnection.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM vectors'
  );
  
  const byModelResult = sqliteConnection.query<{ embedding_model: string; count: number }>(
    'SELECT embedding_model, COUNT(*) as count FROM vectors GROUP BY embedding_model'
  );
  
  const bySourceTypeResult = sqliteConnection.query<{ source_type: string; count: number }>(
    'SELECT source_type, COUNT(*) as count FROM vectors GROUP BY source_type'
  );

  return {
    total: totalResult[0]?.count || 0,
    byModel: Object.fromEntries(byModelResult.map(r => [r.embedding_model, r.count])),
    bySourceType: Object.fromEntries(bySourceTypeResult.map(r => [r.source_type, r.count])),
  };
}
