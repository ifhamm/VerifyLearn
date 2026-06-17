const { getRolePlan, findMaterial, listMaterials } = require('../services/learningPathService');

// Controller for learning logic and path generation

exports.getLearningPath = async (req, res) => {
  try {
    const role = String(req.query.role || 'backend').toLowerCase();
    const duration = parseInt(req.query.duration, 10) || 2;

    const plan = getRolePlan({ role, durationMonths: duration });

    res.json({
      message: 'Learning path fetched successfully',
      data: plan,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
      help: 'Gunakan query params: ?role=backend&duration=2',
    });
  }
};

exports.getMaterial = async (req, res) => {
  try {
    const role = String(req.query.role || 'backend').toLowerCase();
    const slug = String(req.query.slug || '').trim().toLowerCase();

    if (!slug) {
      const list = listMaterials(role);
      return res.json({
        message: 'Material list fetched successfully',
        data: list,
      });
    }

    const material = findMaterial(role, slug);
    if (!material) {
      return res.status(404).json({
        error: 'Material not found',
        help: 'Pastikan parameter slug benar atau gunakan endpoint tanpa slug untuk daftar materi',
      });
    }

    res.json({
      message: 'Material fetched successfully',
      data: {
        id: material.doc_id,
        slug: material.slug,
        title: material.topic_name,
        role: material.role,
        topic_type: material.topic_type,
        parent_topic: material.parent_topic,
        content: material.content,
        content_with_links: material.content_with_links,
        expanded_content: material.expanded_content || material.content,
        position_in_roadmap: material.position_in_roadmap,
        priority: material.priority || null,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};