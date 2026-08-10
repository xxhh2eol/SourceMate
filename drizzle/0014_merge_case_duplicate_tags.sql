-- 合并仅大小写不同的重复标签（如「插件/Skill」与「插件/skill」、「AI」与「ai」）。
-- 规则：每组保留 id 最小（先到先得）的行作为规范标签，其余行的项目关联迁移后删除。
-- 配合 dao.ts 中 getOrCreateTag/createCandidateTag 的 COLLATE NOCASE 查找，
-- 防止以后再次产生大小写变体行。

-- 1) 把重复行的项目关联迁往保留行（同项目已有关联则忽略，保留原记录）
INSERT OR IGNORE INTO project_tags (project_id, tag_id, source, confidence, ai_model, reason, created_at)
SELECT pt.project_id, keep.keep_id, pt.source, pt.confidence, pt.ai_model, pt.reason, pt.created_at
FROM project_tags pt
JOIN tags dup ON dup.id = pt.tag_id
JOIN (
  SELECT lower(name) AS key, MIN(id) AS keep_id
  FROM tags
  GROUP BY lower(name)
  HAVING COUNT(*) > 1
) keep ON lower(dup.name) = keep.key
WHERE dup.id != keep.keep_id;

-- 2) 保留行缺中文名时，从变体行回填
UPDATE tags
SET name_cn = (
  SELECT dup.name_cn
  FROM tags dup
  WHERE lower(dup.name) = lower(tags.name)
    AND dup.id != tags.id
    AND dup.name_cn IS NOT NULL
  LIMIT 1
)
WHERE tags.name_cn IS NULL
  AND EXISTS (
    SELECT 1 FROM tags dup
    WHERE lower(dup.name) = lower(tags.name) AND dup.id != tags.id
  );

-- 3) 清理已被迁移的重复关联
DELETE FROM project_tags
WHERE tag_id IN (
  SELECT dup.id
  FROM tags dup
  JOIN (
    SELECT lower(name) AS key, MIN(id) AS keep_id
    FROM tags
    GROUP BY lower(name)
    HAVING COUNT(*) > 1
  ) keep ON lower(dup.name) = keep.key
  WHERE dup.id != keep.keep_id
);

-- 4) 清空指向被删行的别名引用（alias_of 无外键约束，手工清理）
UPDATE tags
SET alias_of = NULL
WHERE alias_of IN (
  SELECT dup.id
  FROM tags dup
  JOIN (
    SELECT lower(name) AS key, MIN(id) AS keep_id
    FROM tags
    GROUP BY lower(name)
    HAVING COUNT(*) > 1
  ) keep ON lower(dup.name) = keep.key
  WHERE dup.id != keep.keep_id
);

-- 5) 删除重复标签行（project_tags 已迁移，随行级联为空）
DELETE FROM tags
WHERE id IN (
  SELECT dup.id
  FROM tags dup
  JOIN (
    SELECT lower(name) AS key, MIN(id) AS keep_id
    FROM tags
    GROUP BY lower(name)
    HAVING COUNT(*) > 1
  ) keep ON lower(dup.name) = keep.key
  WHERE dup.id != keep.keep_id
);
