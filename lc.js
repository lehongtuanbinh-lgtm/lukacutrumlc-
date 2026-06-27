const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'tiendat.json';
const HISTORY_FILE = 'tiendat1.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.8, // Tăng trọng số để chống ngáo 3T báo X
  'cau_dao_11': 1.6,
  'cau_22': 1.2,
  'cau_33': 1.2,
  'cau_121': 1.0,
  'cau_123': 1.0,
  'cau_321': 1.0,
  'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.0,
  'cau_3van1': 1.0,
  'cau_be_cau': 1.2,
  'cau_chu_ky': 1.0,
  'distribution': 0.8,
  'dice_pattern': 1.0,
  'sum_trend': 1.0,
  'edge_cases': 1.0,
  'momentum': 1.0,
  'cau_tu_nhien': 1.0,
  'dice_trend_line': 1.0,
  'dice_trend_line_md5': 1.0,
  'break_pattern_hu': 1.0,
  'break_pattern_md5': 1.0,
  'fibonacci': 1.0,
  'resistance_support': 1.0,
  'wave': 1.0,
  'golden_ratio': 1.0,
  'day_gay': 1.0,
  'day_gay_md5': 1.0,
  'cau_44': 1.1,
  'cau_55': 1.1,
  'cau_212': 1.0,
  'cau_1221': 1.0,
  'cau_2112': 1.0,
  'cau_gap': 1.0,
  'cau_ziczac': 1.0,
  'cau_doi': 1.0,
  'cau_rong': 1.8,
  'smart_bet': 1.0,
  'break_pattern_advanced': 1.0,
  'break_streak': 1.2,
  'alternating_break': 1.2,
  'double_pair_break': 1.0,
  'triple_pattern': 1.0,
  'tong_phan_tich': 1.3,
  'xu_huong_manh': 1.3,
  'dao_chieu': 1.1,
  // --- THÊM TRỌNG SỐ MỚI VIP ---
  'deep_dice': 1.7, 
  'be_cau_bip': 1.9 
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded successfully from tiendat.json');
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('Prediction history loaded successfully from tiendat1.json');
      console.log(`  - Hu: ${predictionHistory.hu.length} records`);
      console.log(`  - MD5: ${predictionHistory.md5.length} records`);
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        
        const result = calculateAdvancedPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        
        const result = calculateAdvancedPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Error processing predictions:', error.message);
  }
}

async function updateHistoryStatus(type) {
  try {
    let data = null;
    if (type === 'hu') {
      data = await fetchDataHu();
    } else {
      data = await fetchDataMd5();
    }
    
    if (!data || data.length === 0) return;
    
    let updated = false;
    for (const record of predictionHistory[type]) {
      if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
      
      const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
      if (actualResult) {
        const duDoanNormalized = record.Du_doan;
        const ketQuaThucTe = actualResult.Ket_qua;
        
        if (duDoanNormalized === ketQuaThucTe) {
          record.ket_qua_du_doan = 'Đúng ✅';
        } else {
          record.ket_qua_du_doan = 'Sai ❌';
        }
        updated = true;
      }
    }
    
    if (updated) {
      savePredictionHistory();
    }
  } catch (error) {
    console.error(`Error updating ${type} history status:`, error.message);
  }
}

function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

// --- NÂNG CẤP HỌC SÂU (DEEP LEARNING TẦNG CAO) ---
function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  
  // Tăng dung lượng ghi nhớ lịch sử cầu lên 100 ván để học cực dài hạn
  if (stats.recentResults.length > 100) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId] || DEFAULT_PATTERN_WEIGHTS[patternId] || 1.0;
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 10) {
    const ultraRecent = stats.recentResults.slice(-10);
    const ultraRecentAcc = ultraRecent.reduce((a,b)=>a+b,0) / 10;
    
    // Nâng cấp: Phản ứng tinh tế hơn với chuỗi sai, hạ gục ngay các pattern đang dự đoán láo
    if (ultraRecentAcc > 0.7 && recentAccuracy > 0.6) {
      newWeight = Math.min(4.0, oldWeight * 1.15); // Thưởng mạnh
    } else if (ultraRecentAcc < 0.4 && recentAccuracy > 0.5) {
      newWeight = Math.max(0.2, oldWeight * 0.90); // Giảm mạnh hơn cũ
    } else if (ultraRecentAcc <= 0.3 && recentAccuracy <= 0.45) {
      newWeight = Math.max(0.05, oldWeight * 0.70); // Ép chết pattern đang sai liên tục
    } else if (ultraRecentAcc >= 0.7 && recentAccuracy < 0.5) {
      newWeight = Math.min(3.0, oldWeight * 1.1); // Pattern cũ dở nhưng đang vào form
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  // NÂNG CẤP: Tăng trí nhớ tổng từ 1000 lên 2000 ván thực chiến
  if (learningData[type].predictions.length > 2000) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 2000);
  }
  
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 100) {
        learningData[type].recentAccuracy.shift();
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const cleanName = patternName.replace(/\[.*?\]\s*/g, '');
          const patternId = getPatternIdFromName(cleanName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet',
    'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121',
    'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212',
    'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 1-2-1-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac',
    'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet',
    'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution',
    'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum',
    'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line',
    'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Cầu Liên Tục': 'break_pattern_hu',
    'MD5 Cầu': 'break_pattern_md5',
    'Dây Gãy': 'day_gay',
    'MD5 Dây Gãy': 'day_gay_md5',
    'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu',
    'Phân Tích Xúc Xắc Sâu': 'deep_dice',
    'Bẻ Cầu Bịp': 'be_cau_bip'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.70) return 10;
  if (accuracy > 0.60) return 6;
  if (accuracy > 0.50) return 3;
  if (accuracy < 0.30) return -10;
  if (accuracy < 0.40) return -6;
  
  return 0;
}

// --- NÂNG CẤP: THUẬT TOÁN ĐẢO THÔNG MINH BẤT TỬ VIP (KHẮC PHỤC NGÁO) ---
function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  // 1. Nhận diện các cầu siêu cứng (Phải đủ dài mới công nhận là cứng để tránh bị lừa)
  let isStrongUnbreakablePattern = false;
  let strongReason = "";
  
  if (patterns && patterns.length > 0) {
    for (const p of patterns) {
      if (!p.detected) continue;
      
      // Bệt phải từ 3 tay trở lên mới là cứng
      if (p.patternId === 'cau_bet' && p.length >= 3) {
        isStrongUnbreakablePattern = true;
        strongReason = `Bệt ${p.length} tay`;
        break;
      }
      // 1-1 phải từ 4 tay trở lên mới là cứng
      if (p.patternId === 'cau_dao_11' && p.length >= 4) {
        isStrongUnbreakablePattern = true;
        strongReason = `Đảo 1-1 (${p.length} tay)`;
        break;
      }
      if (p.patternId === 'cau_rong') {
        isStrongUnbreakablePattern = true;
        strongReason = `Cầu Rồng`;
        break;
      }
    }
  }

  // 2. Logic Đảo Thông Minh Bất Tử (Chống Gãy)
  // Tool báo sai 2 tay liên tiếp (<= -2) -> Kích hoạt chế độ cứu thua
  if (streakInfo.currentStreak <= -2) {
    if (isStrongUnbreakablePattern) {
      // Đang thua nhưng gặp đúng Cầu Đẹp -> TIN TƯỞNG CẦU ĐẸP, không đảo bậy
      // VD: Đang thua mà thấy nó bệt 3 Tài -> Phải báo Tài, không được đảo Xỉu
      return { 
        adjusted: false, 
        prediction: prediction, 
        reason: `[ÔM CẦU VIP] Giữ nguyên theo ${strongReason} (Bỏ qua đảo)`
      };
    } else {
      // Cầu linh tinh (nhảy cóc, tự nhiên, phân bố...) mà đang thua -> Kích hoạt ĐẢO
      const inverted = prediction === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        adjusted: true,
        prediction: inverted,
        reason: `[VIP ĐẢO CHIỀU CHỐNG GÃY] Đảo ${prediction} → ${inverted} (Đang gãy ${Math.abs(streakInfo.currentStreak)} tay)`
      };
    }
  }
  
  // 3. Logic Machine Learning Trọng Số
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = p.patternId || getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const longTermAcc = stats.accuracy || 0.5;
        const combinedAcc = (recentAcc * 0.8) + (longTermAcc * 0.2); // Ưu tiên phong độ gần đây hơn
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += combinedAcc * weight;
        } else if (p.prediction === 'Xỉu') {
          xiuPatternScore += combinedAcc * weight;
        }
      }
    }
  });
  
  // Nếu chênh lệch quá rõ rệt từ AI
  if (Math.abs(taiPatternScore - xiuPatternScore) > 1.0) {
    const aiPred = taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
    if (aiPred !== prediction && !isStrongUnbreakablePattern) {
      return {
        adjusted: true,
        prediction: aiPred,
        reason: `[AI DEEP LEARNING] Bẻ theo phân tích sâu (Tài: ${taiPatternScore.toFixed(1)}, Xỉu: ${xiuPatternScore.toFixed(1)})`
      };
    }
  }
  
  return { adjusted: false, prediction: prediction, reason: "" };
}

function normalizeResult(result) {
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
}

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) {
    return null;
  }
  
  return apiData.list.map(item => {
    const result = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
    return {
      Phien: item.id,
      Ket_qua: result,
      Xuc_xac_1: item.dices[0],
      Xuc_xac_2: item.dices[1],
      Xuc_xac_3: item.dices[2],
      Tong: item.point
    };
  });
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return null;
  }
}

// ==================== CÁC HÀM PHÂN TÍCH GIỮ NGUYÊN 100% GỐC VÀ NÂNG CẤP THÊM ====================

// --- NÂNG CẤP TÍNH NĂNG 1: HỌC XÚC XẮC SÂU (DEEP DICE) ---
function analyzeDeepDice(data, type) {
  if (data.length < 5) return { detected: false };
  
  const recent5 = data.slice(0, 5);
  const sums = recent5.map(d => d.Tong);
  const weight = getPatternWeight(type, 'deep_dice');
  
  // Lực điểm đang lao dốc (Ví dụ: 15 -> 13 -> 12 -> Đang đà Xỉu)
  let isDropping = sums[0] < sums[1] && sums[1] < sums[2] && sums[0] <= 10;
  if (isDropping) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(85 * weight),
      name: `Phân Tích Xúc Xắc Sâu (Gia tốc điểm tụt ${sums[2]}→${sums[1]}→${sums[0]} → Xỉu)`,
      patternId: 'deep_dice'
    };
  }

  // Lực điểm đang thăng hoa (Ví dụ: 6 -> 8 -> 11 -> Đang đà Tài)
  let isRising = sums[0] > sums[1] && sums[1] > sums[2] && sums[0] >= 11;
  if (isRising) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(85 * weight),
      name: `Phân Tích Xúc Xắc Sâu (Gia tốc điểm tăng ${sums[2]}→${sums[1]}→${sums[0]} → Tài)`,
      patternId: 'deep_dice'
    };
  }

  // Điểm cực hạn (Nổ 3, 4 hoặc 17, 18 thường có xu hướng bật ngược mạnh ở ván kế hoặc kế tiếp)
  if (sums[0] <= 5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 * weight),
      name: `Phân Tích Xúc Xắc Sâu (Chạm đáy ${sums[0]} điểm → Bật Tài)`,
      patternId: 'deep_dice'
    };
  }
  if (sums[0] >= 16) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 * weight),
      name: `Phân Tích Xúc Xắc Sâu (Chạm đỉnh ${sums[0]} điểm → Bật Xỉu)`,
      patternId: 'deep_dice'
    };
  }

  return { detected: false };
}

// --- NÂNG CẤP TÍNH NĂNG 2: BẺ CẦU BỊP (SMART BREAK) ---
function analyzeBeCauBip(data, type) {
  if (data.length < 6) return { detected: false };
  const recent6 = data.slice(0, 6);
  const results = recent6.map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'be_cau_bip');
  
  // Phát hiện bệt ảo (Ví dụ bệt 5 Tài liên tiếp nhưng toàn Tài 11, Tài hèn)
  let isBet = results.slice(0, 5).every(r => r === results[0]);
  if (isBet) {
    const sumAverage = recent6.slice(0, 5).reduce((a, b) => a + b.Tong, 0) / 5;
    if (results[0] === 'Tài' && sumAverage <= 11.5) {
      // Bệt Tài nhưng toàn điểm nhỏ mép Xỉu -> Lực đã cạn, báo bẻ
      return {
        detected: true,
        prediction: 'Xỉu',
        confidence: Math.round(90 * weight),
        name: `Bẻ Cầu Bịp (Bệt Tài ${results[0]} ảo, lực yếu TB ${sumAverage.toFixed(1)} đ → Bẻ Xỉu)`,
        patternId: 'be_cau_bip'
      };
    }
    if (results[0] === 'Xỉu' && sumAverage >= 9.5) {
      // Bệt Xỉu nhưng toàn điểm to mép Tài -> Lực cạn, báo bẻ
      return {
        detected: true,
        prediction: 'Tài',
        confidence: Math.round(90 * weight),
        name: `Bẻ Cầu Bịp (Bệt Xỉu ${results[0]} ảo, lực yếu TB ${sumAverage.toFixed(1)} đ → Bẻ Tài)`,
        patternId: 'be_cau_bip'
      };
    }
  }

  return { detected: false };
}


function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  
  // Phân tích tổng điểm
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.filter(r => r === 'Xỉu').length;
  
  // Phân tích xu hướng tổng
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (sumTrend > 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 + Math.abs(sumTrend) * 3),
      name: `Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(70 + Math.abs(taiCount - xiuCount) * 3),
      name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recent8 = results.slice(0, 8);
  const taiCount = recent8.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  
  if (taiCount >= 6) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(80 + taiCount * 2),
      name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(80 + (8 - taiCount) * 2),
      name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  
  const recent5 = results.slice(0, 5);
  const weight = getPatternWeight(type, 'dao_chieu');
  
  let isAlternating = true;
  for (let i = 0; i < recent5.length - 1; i++) {
    if (recent5[i] === recent5[i + 1]) {
      isAlternating = false;
      break;
    }
  }
  
  if (isAlternating) {
    const prediction = recent5[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 75,
      name: `Đảo Chiều (Chuỗi ${recent5.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 2) { // Giảm xuống >= 2 để nhận diện sớm, ưu tiên mạnh ở >=3
    const weight = getPatternWeight(type, 'cau_bet');
    
    let shouldBreak = streakLength >= 6; // Đẩy giới hạn bẻ lên xa hơn để ôm cầu
    let confidence = 65;
    
    if (streakLength >= 7) {
      shouldBreak = true;
      confidence = 85;
    } else if (streakLength >= 5) {
      shouldBreak = false; // Vẫn ưu tiên bám
      confidence = 80;
    } else if (streakLength >= 3) {
      shouldBreak = false;
      confidence = 90; // Rất tự tin báo thuận cầu (Chống lỗi 3T báo X)
    } else if (streakLength === 2) {
      shouldBreak = false;
      confidence = 70;
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(confidence * weight),
      name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 3) { // Nhận diện sớm
    const weight = getPatternWeight(type, 'cau_dao_11');
    const confidence = Math.min(90, 70 + alternatingLength * 4); // Tăng độ tự tin
    
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(confidence * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(78, 65 + pairCount * 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(80, 68 + tripleCount * 4) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] && 
      pattern1[1] === pattern1[2] && 
      pattern1[2] !== pattern1[3] &&
      pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(72 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
  }
  
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(74 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(76 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(68 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(66 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 >= 4) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Tài',
      confidence: Math.round(70 * weight),
      name: `Cầu Nhịp Nghiêng (${taiCount5}/5 Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      prediction: 'Xỉu',
      confidence: Math.round(70 * weight),
      name: `Cầu Nhịp Nghiêng (${5 - taiCount5}/5 Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  
  if (taiCount === 3) {
    return { 
      detected: true, 
      prediction: 'Xỉu',
      confidence: Math.round(68 * weight),
      name: 'Cầu 3 Ván 1 (3T-1X) → Xỉu',
      patternId: 'cau_3van1'
    };
  } else if (taiCount === 1) {
    return { 
      detected: true, 
      prediction: 'Tài',
      confidence: Math.round(68 * weight),
      name: 'Cầu 3 Ván 1 (3X-1T) → Tài',
      patternId: 'cau_3van1'
    };
  }
  
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  
  const recentStreak = analyzeCauBet(results, type);
  
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { 
        detected: true, 
        prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(76 * weight),
        name: 'Cầu Bẻ Cầu',
        patternId: 'cau_be_cau'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  
  return { 
    detected: true, 
    prediction: results[0],
    confidence: Math.round(65 * weight), // Nâng tự tin gốc
    name: 'Cầu Tự Nhiên (Bám Theo Sóng)',
    patternId: 'cau_tu_nhien'
  };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return { 
      detected: true, 
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(88, 75 + streakLength) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(78 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(82 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X) → Đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeBreakStreak(results, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_streak') || 1.0;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(85, 70 + streakLength) * weight),
      name: `Bẻ Chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}

function analyzeAlternatingBreak(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'alternating_break') || 1.0;
  
  let alternatingCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i + 1]) {
      alternatingCount++;
    } else {
      break;
    }
  }
  
  if (alternatingCount >= 6) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(82, 68 + alternatingCount) * weight),
      name: `Bẻ Đảo ${alternatingCount} phiên → ${prediction}`,
      patternId: 'alternating_break'
    };
  }
  
  return { detected: false };
}

function analyzeDoublePairBreak(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'double_pair_break') || 1.0;
  
  const isPair1 = results[0] === results[1];
  const isPair2 = results[2] === results[3];
  const isPair3 = results[4] === results[5];
  const isPair4 = results[6] === results[7];
  
  if (isPair1 && isPair2 && isPair3 && isPair4) {
    const pairType1 = results[0];
    const pairType2 = results[2];
    
    const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
    if (allSamePair) {
      const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(84 * weight),
        name: `4 Cặp Cùng ${pairType1} → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(78 * weight),
        name: `Cặp Đảo Xen Kẽ → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
  }
  
  return { detected: false };
}

function analyzeTriplePattern(results, type) {
  if (results.length < 9) return { detected: false };
  
  const weight = getPatternWeight(type, 'triple_pattern') || 1.0;
  
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  
  if (isTriple1 && isTriple2 && isTriple3) {
    const tripleType1 = results[0];
    const tripleType2 = results[3];
    const tripleType3 = results[6];
    
    if (tripleType1 === tripleType2 && tripleType2 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(88 * weight),
        name: `3 Bộ Ba Cùng ${tripleType1} → Bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        prediction,
        confidence: Math.round(80 * weight),
        name: `Bộ Ba Đảo → Theo ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN CHÍNH (GẮN AI VIP DEEP LEARNING) ====================

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // 1. Phân tích Xúc Xắc Sâu (Ưu tiên Cao Nhất vì nó là Dữ Liệu Gốc)
  const deepDice = analyzeDeepDice(last50, type);
  if (deepDice.detected) {
    predictions.push({ prediction: deepDice.prediction, confidence: deepDice.confidence, priority: 20, name: deepDice.name });
    factors.push(deepDice.name);
    allPatterns.push(deepDice);
  }

  // 2. Bẻ Cầu Bịp (Phát hiện cầu chạy dài nhưng điểm cạn kiệt)
  const beCauBip = analyzeBeCauBip(last50, type);
  if (beCauBip.detected) {
    predictions.push({ prediction: beCauBip.prediction, confidence: beCauBip.confidence, priority: 19, name: beCauBip.name });
    factors.push(beCauBip.name);
    allPatterns.push(beCauBip);
  }

  // Tăng cực đại Priority của Cầu Bệt và Đảo 1-1 để dập tắt mấy thuật toán ngáo
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    // Nếu Bệt >= 3 tay thì cấp quyền lực cực lớn
    const bPriority = cauBet.length >= 3 ? 18 : 9; 
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: bPriority, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    // Nếu 1-1 >= 3 tay thì cấp quyền ưu tiên lớn
    const dPriority = cauDao11.length >= 3 ? 18 : 9;
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: dPriority, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }

  const tongPhanTich = analyzeTongPhanTich(last50, type);
  if (tongPhanTich.detected) {
    predictions.push({ prediction: tongPhanTich.prediction, confidence: tongPhanTich.confidence, priority: 15, name: tongPhanTich.name });
    factors.push(tongPhanTich.name);
    allPatterns.push(tongPhanTich);
  }
  
  const xuHuongManh = analyzeXuHuongManh(results, type);
  if (xuHuongManh.detected) {
    predictions.push({ prediction: xuHuongManh.prediction, confidence: xuHuongManh.confidence, priority: 14, name: xuHuongManh.name });
    factors.push(xuHuongManh.name);
    allPatterns.push(xuHuongManh);
  }
  
  const daoChieu = analyzeDaoChieu(results, type);
  if (daoChieu.detected) {
    predictions.push({ prediction: daoChieu.prediction, confidence: daoChieu.confidence, priority: 13, name: daoChieu.name });
    factors.push(daoChieu.name);
    allPatterns.push(daoChieu);
  }
  
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 12, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  const breakStreak = analyzeBreakStreak(results, type);
  if (breakStreak.detected) {
    predictions.push({ prediction: breakStreak.prediction, confidence: breakStreak.confidence, priority: 11, name: breakStreak.name });
    factors.push(breakStreak.name);
    allPatterns.push(breakStreak);
  }
  
  const triplePattern = analyzeTriplePattern(results, type);
  if (triplePattern.detected) {
    predictions.push({ prediction: triplePattern.prediction, confidence: triplePattern.confidence, priority: 11, name: triplePattern.name });
    factors.push(triplePattern.name);
    allPatterns.push(triplePattern);
  }
  
  const doublePairBreak = analyzeDoublePairBreak(results, type);
  if (doublePairBreak.detected) {
    predictions.push({ prediction: doublePairBreak.prediction, confidence: doublePairBreak.confidence, priority: 10, name: doublePairBreak.name });
    factors.push(doublePairBreak.name);
    allPatterns.push(doublePairBreak);
  }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 10, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 7, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) {
    predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name });
    factors.push(cauNhipNghieng.name);
    allPatterns.push(cauNhipNghieng);
  }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  const alternatingBreak = analyzeAlternatingBreak(results, type);
  if (alternatingBreak.detected) {
    predictions.push({ prediction: alternatingBreak.prediction, confidence: alternatingBreak.confidence, priority: 8, name: alternatingBreak.name });
    factors.push(alternatingBreak.name);
    allPatterns.push(alternatingBreak);
  }
  
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.15) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    // Đẩy priority xuống thấp 1 chút để không dẫm lên cầu bệt
    predictions.push({ prediction: minority, confidence: 65, priority: 3, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Dự đoán nền tảng từ AI
  let basePrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // ĐƯA VÀO BỘ LỌC ĐẢO CHIỀU VIP THÔNG MINH
  let smartAdjustment = getSmartPredictionAdjustment(type, basePrediction, allPatterns);
  let finalPrediction = smartAdjustment.adjusted ? smartAdjustment.prediction : basePrediction;
  
  let baseConfidence = 65;
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 65) * 0.35; // Tăng biên độ tự tin
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 15);
  
  // Ghi log lý do cho User hiểu AI đang nghĩ gì
  if (smartAdjustment.reason !== "") {
    factors.unshift(smartAdjustment.reason);
    if (smartAdjustment.adjusted) {
       baseConfidence += 10; // Tự tin hơn khi bẻ cầu bịp/đảo kết quả
    } else {
       baseConfidence += 5; // Tự tin khi ôm cầu cứng
    }
  }
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  finalConfidence = Math.max(65, Math.min(98, finalConfidence)); // Tăng min-max
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore,
      xiuScore,
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: '@vilong',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'hu');
    
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('hu');
    }, 5000);
    
    const last15 = data.slice(0, 15).map(d => d.Ket_qua === 'Tài' ? 't' : 'x').reverse().join('');
    const topFactor = result.factors.length > 0 ? result.factors[0] : 'Cầu Tự Nhiên';
    const patternStr = `[VIP CẦU: ${topFactor}] [CHUẨN] - Dự kiến: Cân bằng (${last15})`;

    const kqMap = {'Tài': 'TAI', 'Xỉu': 'XIU'};
    const ddMap = {'Tài': 'TÀI', 'Xỉu': 'XỈU'};

    res.json({
      id: "by VIP @vilong",
      phien_truoc: record.Phien,
      tong: record.Tong,
      ket_qua: kqMap[record.Ket_qua] || record.Ket_qua.toUpperCase(),
      pattern: patternStr,
      phien_hien_tai: parseInt(record.Phien_hien_tai),
      du_doan: ddMap[record.Du_doan] || record.Du_doan.toUpperCase(),
      do_tin_cay: record.Do_tin_cay
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(data, 'md5');
    
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('md5');
    }, 5000);
    
    const last15 = data.slice(0, 15).map(d => d.Ket_qua === 'Tài' ? 't' : 'x').reverse().join('');
    const topFactor = result.factors.length > 0 ? result.factors[0] : 'Cầu Tự Nhiên';
    const patternStr = `[VIP CẦU: ${topFactor}] [CHUẨN] - Dự kiến: Cân bằng (${last15})`;

    const kqMap = {'Tài': 'TAI', 'Xỉu': 'XIU'};
    const ddMap = {'Tài': 'TÀI', 'Xỉu': 'XỈU'};

    res.json({
      id: "by VIP @vilong",
      phien_truoc: record.Phien,
      tong: record.Tong,
      ket_qua: kqMap[record.Ket_qua] || record.Ket_qua.toUpperCase(),
      pattern: patternStr,
      phien_hien_tai: parseInt(record.Phien_hien_tai),
      du_doan: ddMap[record.Du_doan] || record.Du_doan.toUpperCase(),
      do_tin_cay: record.Do_tin_cay
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('hu');
    
    const shortHistory = predictionHistory.hu.map(record => ({
      Phien: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      Trang_thai: record.ket_qua_du_doan || 'Đang chờ...'
    }));
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: shortHistory,
      total: shortHistory.length
    });
  } catch (error) {
    const shortHistory = predictionHistory.hu.map(record => ({
      Phien: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      Trang_thai: record.ket_qua_du_doan || 'Đang chờ...'
    }));
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu Hũ',
      history: shortHistory,
      total: shortHistory.length
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('md5');
    
    const shortHistory = predictionHistory.md5.map(record => ({
      Phien: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      Trang_thai: record.ket_qua_du_doan || 'Đang chờ...'
    }));
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: shortHistory,
      total: shortHistory.length
    });
  } catch (error) {
    const shortHistory = predictionHistory.md5.map(record => ({
      Phien: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      Trang_thai: record.ket_qua_du_doan || 'Đang chờ...'
    }));
    
    res.json({
      type: 'Lẩu Cua 79 - Tài Xỉu MD5',
      history: shortHistory,
      total: shortHistory.length
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const result = calculateAdvancedPrediction(data, 'hu');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const result = calculateAdvancedPrediction(data, 'md5');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/api-taixiumd5/lc79/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis
  });
});

app.get('/api/taixiumd5/lc79/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Lẩu Cua 79 - Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    },
    md5: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Lau Cua 79 - Advanced Tai Xiu Prediction API v8.0 VIP AI ULTRA');
  console.log('');
  console.log('CẢI TIẾN VIP MỚI NHẤT (THEO YÊU CẦU):');
  console.log('  - SỬA LỖI NGÁO: Tăng Priority cho Cầu Bệt và 1-1, khắc phục lỗi 3T báo X.');
  console.log('  - HỌC XÚC XẮC SÂU: Đọc lực cạn kiệt/thăng hoa của điểm số để bẻ cầu bịp.');
  console.log('  - ĐẢO BẤT TỬ V2: Tự động ngắt đảo nếu gặp bệt >= 3 tay hoặc 1-1 >= 4 tay.');
  console.log('  - NÃO BỘ 2000 VÁN: Phản ứng cực nhanh với các Pattern đang có phong độ kém.');
  console.log('');
  console.log('FILE: tiendat.json, tiendat1.json');
  console.log('ID: @vilong');
  
  startAutoSaveTask();
});