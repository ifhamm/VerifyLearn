const fs = require('fs');
const path = require('path');

let DATA_DIR = path.join(__dirname, '../../../python_ai/data');
if (!fs.existsSync(DATA_DIR)) {
  // Fallback for Docker container where python_ai is mounted inside backend folder /app
  DATA_DIR = path.join(__dirname, '../../python_ai/data');
}

const KB_DIR = path.join(DATA_DIR, 'knowledge_base');
const CONFIG_PATH = path.join(DATA_DIR, 'curriculum_config.json');

const HOURS_PER_WEEK = {
  1: 10,
  2: 8,
  3: 6,
};

const loadConfig = () => {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Curriculum config not found: ${CONFIG_PATH}`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
};

const loadKnowledgeBase = (role) => {
  const filePath = path.join(KB_DIR, `${role}.jsonl`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Knowledge base not found for role: ${role}`);
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  return lines.map((line) => {
    const doc = JSON.parse(line);
    return {
      ...doc,
      expanded_content: doc.expanded_content || doc.content,
    };
  });
};

const findMaterial = (role, slug) => {
  const docs = loadKnowledgeBase(role);
  const normalized = String(slug || '').toLowerCase();

  return docs.find((doc) => {
    if (doc.slug && String(doc.slug).toLowerCase() === normalized) {
      return true;
    }
    if (doc.topic_name && String(doc.topic_name).toLowerCase().replace(/[^a-z0-9]+/g, '-') === normalized) {
      return true;
    }
    return false;
  });
};

const listMaterials = (role) => {
  const docs = loadKnowledgeBase(role);
  return docs.map((doc) => ({
    id: doc.doc_id,
    slug: doc.slug,
    title: doc.topic_name,
    topic_type: doc.topic_type,
    parent_topic: doc.parent_topic,
  }));
};

const getHoursPerWeek = (durationWeeks) => {
  if (durationWeeks <= 1) return 10;
  if (durationWeeks <= 2) return 8;
  if (durationWeeks <= 4) return 8;
  if (durationWeeks <= 12) return 6;
  return 5;
};

const getRolePlan = ({ role, durationWeeks }) => {
  const config = loadConfig();
  const roleConfig = config[role];
  if (!roleConfig) {
    throw new Error(`Unknown role: ${role}`);
  }

  const rawDocs = loadKnowledgeBase(role);
  const coreNames = new Set([...(roleConfig.core_topics || []), ...(roleConfig.core_subtopics || [])]);
  const advancedNames = new Set([...(roleConfig.advanced_topics || []), ...(roleConfig.advanced_subtopics || [])]);

  const sortedDocs = rawDocs.sort((a, b) => {
    const aType = a.topic_type === 'topic' ? 0 : 1;
    const bType = b.topic_type === 'topic' ? 0 : 1;
    if (aType !== bType) return aType - bType;
    return (a.position_in_roadmap || 999) - (b.position_in_roadmap || 999);
  });

  const coreDocs = [];
  const advancedDocs = [];
  const otherDocs = [];

  for (const doc of sortedDocs) {
    const name = doc.topic_name;
    if (coreNames.has(name)) {
      coreDocs.push(doc);
    } else if (advancedNames.has(name)) {
      advancedDocs.push(doc);
    } else {
      otherDocs.push(doc);
    }
  }

  const totalWeeks = durationWeeks;
  const hoursPerWeek = getHoursPerWeek(durationWeeks);
  const hoursPerMaterial = 2;
  const slotsPerWeek = Math.max(1, Math.floor(hoursPerWeek / hoursPerMaterial));
  const totalSlots = totalWeeks * slotsPerWeek;

  const selected = [];
  if (totalSlots <= coreDocs.length) {
    selected.push(...coreDocs.slice(0, totalSlots));
  } else {
    selected.push(...coreDocs);
    let remaining = totalSlots - selected.length;

    if (remaining > 0) {
      selected.push(...advancedDocs.slice(0, remaining));
      remaining = totalSlots - selected.length;
    }

    if (remaining > 0) {
      selected.push(...otherDocs.slice(0, remaining));
    }
  }

  const materials = selected.map((doc, index) => {
    const weekNumber = Math.min(Math.floor(index / slotsPerWeek) + 1, totalWeeks);
    const name = doc.topic_name;
    const priority = coreNames.has(name) ? 'core' : advancedNames.has(name) ? 'advanced' : 'supplementary';

    return {
      id: doc.doc_id || `${role}-${index + 1}`,
      slug: doc.slug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: name,
      role,
      topic_type: doc.topic_type || 'subtopic',
      priority,
      parent_topic: doc.parent_topic || '',
      content_summary: (doc.content || '').slice(0, 300).trim(),
      week_number: weekNumber,
      estimated_hours: hoursPerMaterial,
    };
  });

  const weeklySchedule = [];
  for (let week = 1; week <= totalWeeks; week += 1) {
    const materialsForWeek = materials.filter((item) => item.week_number === week);
    if (materialsForWeek.length > 0) {
      weeklySchedule.push({ week, materials: materialsForWeek });
    }
  }

  const scheduledSlugs = new Set(materials.map(m => m.slug));
  const allMaterialsList = rawDocs.map((doc, index) => {
    const name = doc.topic_name;
    const priority = coreNames.has(name) ? 'core' : advancedNames.has(name) ? 'advanced' : 'supplementary';
    const isScheduled = scheduledSlugs.has(doc.slug);
    
    let status = isScheduled ? 'wajib' : 'pilihan';
    if (!isScheduled && totalWeeks <= 2) {
      status = 'dilewati';
    }
    
    // Find the week number if scheduled
    const matched = materials.find(m => m.slug === doc.slug);
    const weekNumber = matched ? matched.week_number : null;

    return {
      id: doc.doc_id || `${role}-${index + 1}`,
      slug: doc.slug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: name,
      role,
      topic_type: doc.topic_type || 'subtopic',
      priority,
      parent_topic: doc.parent_topic || '',
      content_summary: (doc.content || '').slice(0, 300).trim(),
      week_number: weekNumber,
      estimated_hours: hoursPerMaterial,
      status: status
    };
  });

  const coreCount = allMaterialsList.filter((m) => m.priority === 'core').length;
  const advancedCount = allMaterialsList.filter((m) => m.priority === 'advanced').length;

  const paceNote = `${hoursPerWeek} hours/week, ${totalWeeks} weeks total.`;

  return {
    role,
    duration_months: Math.ceil(durationWeeks / 4),
    total_weeks: totalWeeks,
    hours_per_week: hoursPerWeek,
    total_materials: allMaterialsList.length,
    core_materials: coreCount,
    advanced_materials: advancedCount,
    weekly_schedule: weeklySchedule,
    materials: allMaterialsList,
    pace_note: paceNote,
  };
};

module.exports = {
  getRolePlan,
  findMaterial,
  listMaterials,
};
