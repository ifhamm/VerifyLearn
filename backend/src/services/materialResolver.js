const { findMaterial } = require('./learningPathService');

// Helper to resolve material from payload
const resolveMaterial = (role, slug, material) => {
  if (material) return material;
  if (!role || !slug) {
    throw new Error('Must include material object or parameters (role and slug).');
  }
  const found = findMaterial(role, slug);
  if (!found) {
    throw new Error(`Material not found for role: ${role}, slug: ${slug}`);
  }
  // Convert JSONL structure to the structure expected by python_ai server
  return {
    id: found.doc_id,
    slug: found.slug,
    title: found.topic_name,
    role: found.role,
    topic_type: found.topic_type,
    parent_topic: found.parent_topic,
    content_summary: (found.content || '').slice(0, 300).trim(),
  };
};

module.exports = {
  resolveMaterial,
};
