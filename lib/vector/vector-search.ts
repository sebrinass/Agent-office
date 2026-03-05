/**
 * 向量检索模块
 * 
 * 提供全文检索和向量相似度检索功能
 * 由于 sql.js 不支持 FTS5 扩展，全文检索使用 LIKE 实现
 * 向量相似度使用余弦相似度计算
 */

import { sqliteConnection } from './sqlite-connection';
import { getAllVectors } from './vector-store';

// ============ 类型定义 ============

export interface SearchResult {
  id: string;
  source_type: string;
  source_id: string;
  content: string;
  score: number;
  rank?: number;
  created_at: number;
}

export interface HybridSearchResult extends SearchResult {
  textScore: number;
  textRank: number;
  vectorScore: number;
  vectorRank: number;
  rrfScore: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  sourceTypes?: string[];
  minScore?: number;
}

export interface VectorSearchOptions extends SearchOptions {
  embeddingModel?: string;
  threshold?: number;
}

export interface HybridSearchOptions extends SearchOptions {
  textWeight?: number; // 文本检索权重 (0-1)
  vectorWeight?: number; // 向量检索权重 (0-1)
  rrfK?: number; // RRF 常数，默认 60
}

// ============ 常量配置 ============

const DEFAULT_SEARCH_LIMIT = 20;
const RRF_K = 60; // RRF 常数，业界标准

// ============ 全文检索 ============

/**
 * 分词函数（简单实现）
 * 支持中文和英文
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  
  const tokens: string[] = [];
  const cjkRegex = /[\u4e00-\u9fff]/;
  const wordRegex = /[a-zA-Z0-9]+/g;
  
  const lowerText = text.toLowerCase();
  const parts = lowerText.split(/[\s\p{P}]+/u).filter(Boolean);
  
  for (const part of parts) {
    const cjkChars = part.split('').filter(c => cjkRegex.test(c));
    const nonCjkMatch = part.match(wordRegex);
    
    if (nonCjkMatch) {
      tokens.push(...nonCjkMatch);
    }
    
    // 中文二元分词
    for (let i = 0; i < cjkChars.length - 1; i++) {
      tokens.push(cjkChars[i] + cjkChars[i + 1]);
    }
    
    // 单字也加入
    if (cjkChars.length > 0) {
      tokens.push(...cjkChars);
    }
  }
  
  return tokens;
}

/**
 * 全文检索（使用 LIKE）
 */
export async function fullTextSearch(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const limit = options?.limit || DEFAULT_SEARCH_LIMIT;
  const offset = options?.offset || 0;
  const minScore = options?.minScore || 0;
  
  // 分词
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  
  // 构建 LIKE 条件
  const conditions: string[] = [];
  const params: string[] = [];
  
  for (const token of tokens) {
    conditions.push(`content LIKE $${params.length + 1}`);
    params.push(`%${token}%`);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' OR ')}` : '';
  
  // 添加 source_type 过滤
  if (options?.sourceTypes && options.sourceTypes.length > 0) {
    const typeConditions = options.sourceTypes.map((_, i) => `source_type = $${params.length + i + 1}`);
    params.push(...options.sourceTypes);
    const typeWhere = typeConditions.join(' OR ');
    const combinedWhere = whereClause 
      ? `${whereClause} AND (${typeWhere})`
      : `WHERE ${typeWhere}`;
    
    return sqliteConnection.query<SearchResult>(
      `SELECT id, source_type, source_id, content, created_at, 1.0 as score
       FROM search_index ${combinedWhere}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
  }
  
  const results = sqliteConnection.query<SearchResult>(
    `SELECT id, source_type, source_id, content, created_at, 1.0 as score
     FROM search_index ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  
  // 计算简单的相关性分数
  return results.map((result, index) => {
    let score = 0;
    const content = result.content.toLowerCase();
    
    for (const token of tokens) {
      const regex = new RegExp(token, 'gi');
      const matches = content.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    
    return {
      ...result,
      score: score / (index + 1), // 简单的排序衰减
    };
  }).filter(r => r.score >= minScore);
}

/**
 * 在编辑记录中搜索
 */
export async function searchEditRecords(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const limit = options?.limit || DEFAULT_SEARCH_LIMIT;
  const offset = options?.offset || 0;
  
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  
  const conditions: string[] = [];
  const params: string[] = [];
  
  // 搜索 new_content 和 old_content
  for (const token of tokens) {
    conditions.push(`(new_content LIKE $${params.length + 1} OR old_content LIKE $${params.length + 2})`);
    params.push(`%${token}%`, `%${token}%`);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' OR ')}` : '';
  
  const results = sqliteConnection.query<{ id: string; document_id: string; new_content: string; old_content: string | null; timestamp: number }>(
    `SELECT id, document_id, new_content, old_content, timestamp
     FROM edit_records ${whereClause}
     ORDER BY timestamp DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  
  return results.map((r, index) => ({
    id: r.id,
    source_type: 'edit_record',
    source_id: r.document_id,
    content: r.new_content || r.old_content || '',
    score: 1.0 / (index + 1),
    created_at: r.timestamp,
  }));
}

// ============ 向量相似度检索 ============

/**
 * 计算余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * 向量相似度检索
 */
export async function vectorSearch(
  queryEmbedding: number[],
  options?: VectorSearchOptions
): Promise<SearchResult[]> {
  const limit = options?.limit || DEFAULT_SEARCH_LIMIT;
  const threshold = options?.threshold || 0.5;
  
  // 获取所有向量
  const allVectors = await getAllVectors(1000);
  
  // 过滤 embedding model
  let filteredVectors = allVectors;
  if (options?.embeddingModel) {
    filteredVectors = allVectors.filter(v => v.embedding_model === options.embeddingModel);
  }
  
  // 过滤 source types
  if (options?.sourceTypes && options.sourceTypes.length > 0) {
    filteredVectors = filteredVectors.filter(v => options.sourceTypes!.includes(v.source_type));
  }
  
  // 计算相似度
  const scored = filteredVectors.map(v => ({
    id: v.id,
    source_type: v.source_type,
    source_id: v.source_id,
    content: v.content,
    created_at: v.created_at,
    score: cosineSimilarity(queryEmbedding, v.embedding_array),
  }));
  
  // 过滤低分结果并排序
  const results = scored
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  // 添加排名
  return results.map((r, index) => ({
    ...r,
    rank: index + 1,
  }));
}

/**
 * 批量向量检索
 */
export async function batchVectorSearch(
  queryEmbeddings: number[][],
  options?: VectorSearchOptions
): Promise<SearchResult[][]> {
  const results: SearchResult[][] = [];
  
  for (const embedding of queryEmbeddings) {
    const result = await vectorSearch(embedding, options);
    results.push(result);
  }
  
  return results;
}

// ============ 混合检索（RRF 融合） ============

/**
 * RRF (Reciprocal Rank Fusion) 融合算法
 * RRF_score(d) = Σ 1/(k + rank(d))
 */
function rrfFusion(
  textResults: SearchResult[],
  vectorResults: SearchResult[],
  k: number = RRF_K
): HybridSearchResult[] {
  const textRankMap = new Map<string, number>();
  const vectorRankMap = new Map<string, number>();
  const resultMap = new Map<string, SearchResult>();
  
  // 记录文本检索排名
  textResults.forEach((result, index) => {
    textRankMap.set(result.id, index + 1);
    resultMap.set(result.id, result);
  });
  
  // 记录向量检索排名
  vectorResults.forEach((result, index) => {
    vectorRankMap.set(result.id, index + 1);
    resultMap.set(result.id, result);
  });
  
  // 计算 RRF 分数
  const fusedResults: HybridSearchResult[] = [];
  
  for (const [id, result] of resultMap) {
    const textRank = textRankMap.get(id) || Infinity;
    const vectorRank = vectorRankMap.get(id) || Infinity;
    
    let rrfScore = 0;
    
    if (textRank !== Infinity) {
      rrfScore += 1 / (k + textRank);
    }
    
    if (vectorRank !== Infinity) {
      rrfScore += 1 / (k + vectorRank);
    }
    
    fusedResults.push({
      ...result,
      textScore: textRank !== Infinity ? result.score : 0,
      textRank: textRank === Infinity ? 0 : textRank,
      vectorScore: vectorRank !== Infinity ? result.score : 0,
      vectorRank: vectorRank === Infinity ? 0 : vectorRank,
      rrfScore,
    });
  }
  
  // 按 RRF 分数排序
  fusedResults.sort((a, b) => b.rrfScore - a.rrfScore);
  
  return fusedResults;
}

/**
 * 混合检索（文本 + 向量）
 */
export async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  options?: HybridSearchOptions
): Promise<HybridSearchResult[]> {
  const limit = options?.limit || DEFAULT_SEARCH_LIMIT;
  const rrfK = options?.rrfK || RRF_K;
  
  // 并行执行文本检索和向量检索
  const [textResults, vectorResults] = await Promise.all([
    fullTextSearch(query, { limit: limit * 2, sourceTypes: options?.sourceTypes }),
    vectorSearch(queryEmbedding, { limit: limit * 2, sourceTypes: options?.sourceTypes }),
  ]);
  
  // RRF 融合
  const fusedResults = rrfFusion(textResults, vectorResults, rrfK);
  
  // 返回 top-k 结果
  return fusedResults.slice(0, limit);
}

// ============ 辅助函数 ============

/**
 * 获取热门内容
 */
export async function getTopContent(
  sourceType?: string,
  limit?: number
): Promise<SearchResult[]> {
  const limitValue = limit || 10;
  
  if (sourceType) {
    return sqliteConnection.query<SearchResult>(
      `SELECT id, source_type, source_id, content, created_at, 1.0 as score
       FROM search_index
       WHERE source_type = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sourceType, limitValue]
    );
  }
  
  return sqliteConnection.query<SearchResult>(
    `SELECT id, source_type, source_id, content, created_at, 1.0 as score
     FROM search_index
     ORDER BY created_at DESC
     LIMIT $1`,
    [limitValue]
  );
}

/**
 * 按来源 ID 搜索
 */
export async function searchBySourceId(
  sourceType: string,
  sourceId: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  const limit = options?.limit || DEFAULT_SEARCH_LIMIT;
  const offset = options?.offset || 0;
  
  return sqliteConnection.query<SearchResult>(
    `SELECT id, source_type, source_id, content, created_at, 1.0 as score
     FROM search_index
     WHERE source_type = $1 AND source_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [sourceType, sourceId, limit, offset]
  );
}

/**
 * 清除搜索索引
 */
export async function clearSearchIndex(): Promise<void> {
  sqliteConnection.exec('DELETE FROM search_index');
}

/**
 * 重建搜索索引
 */
export async function rebuildSearchIndex(): Promise<{ indexed: number }> {
  // 清除现有索引
  await clearSearchIndex();
  
  let indexed = 0;
  
  // 从编辑记录重建
  const editRecords = sqliteConnection.query<{ id: string; new_content: string; timestamp: number }>(
    'SELECT id, new_content, timestamp FROM edit_records WHERE new_content IS NOT NULL'
  );
  
  for (const record of editRecords) {
    sqliteConnection.run(
      `INSERT INTO search_index (id, source_type, source_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [`edit-${record.id}`, 'edit_record', record.id, record.new_content, record.timestamp]
    );
    indexed++;
  }
  
  // 从向量记录重建
  const vectors = sqliteConnection.query<{ id: string; source_type: string; source_id: string; content: string; created_at: number }>(
    'SELECT id, source_type, source_id, content, created_at FROM vectors'
  );
  
  for (const vector of vectors) {
    sqliteConnection.run(
      `INSERT OR REPLACE INTO search_index (id, source_type, source_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [`vector-${vector.id}`, vector.source_type, vector.source_id, vector.content, vector.created_at]
    );
    indexed++;
  }
  
  return { indexed };
}
