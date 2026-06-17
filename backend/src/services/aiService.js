// Service to communicate with the external Python AI Engine
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

exports.analyzeKeystrokes = async (keystrokes) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/verify-keystroke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keystrokes }),
    });

    if (!response.ok) {
      throw new Error(`AI Service returned status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error calling AI Service /api/verify-keystroke:', error);
    return {
      verified: false,
      confidence: 0.0,
      message: `Gagal menghubungi AI Service: ${error.message}`,
      metrics: {
        wpm: 0,
        instant_ratio: 0,
        avg_dwell_ms: 0,
        std_flight_ms: 0
      }
    };
  }
};

exports.generateQuiz = async (material, n_pg = 4, n_essay = 1) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/generate-quiz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ material, n_pg, n_essay }),
    });

    if (!response.ok) {
      throw new Error(`AI Service returned status ${response.status}`);
    }

    const json = await response.json();
    return json.data;
  } catch (error) {
    console.error('Error calling AI Service /api/generate-quiz:', error);
    throw error;
  }
};

exports.generateLivecode = async (material, difficulty = 'normal') => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/generate-livecode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ material, difficulty }),
    });

    if (!response.ok) {
      throw new Error(`AI Service returned status ${response.status}`);
    }

    const json = await response.json();
    return json.data;
  } catch (error) {
    console.error('Error calling AI Service /api/generate-livecode:', error);
    throw error;
  }
};

exports.generateVoiceChallenge = async (material, userCodeOrText, triggerReason) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/generate-voice-challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ material, user_code_or_text: userCodeOrText, trigger_reason: triggerReason }),
    });

    if (!response.ok) {
      throw new Error(`AI Service returned status ${response.status}`);
    }

    const json = await response.json();
    return json.data;
  } catch (error) {
    console.error('Error calling AI Service /api/generate-voice-challenge:', error);
    throw error;
  }
};

exports.generateFinalChallenge = async (material) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/api/generate-final-challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ material }),
    });

    if (!response.ok) {
      throw new Error(`AI Service returned status ${response.status}`);
    }

    const json = await response.json();
    return json.data;
  } catch (error) {
    console.error('Error calling AI Service /api/generate-final-challenge:', error);
    throw error;
  }
};

