// -------------------------
// DOM 元素選取
// -------------------------
const views = {
    record: document.getElementById('view-record'),
    process: document.getElementById('view-process'),
    result: document.getElementById('view-result')
};

const processTitle = document.getElementById('process-title');
const processDesc = document.getElementById('process-desc');

const tabBtns = document.querySelectorAll('.tab-btn');
const btnRecord = document.getElementById('btn-record');
const recordPulse = document.getElementById('record-pulse');
const timerDisplay = document.getElementById('timer');
const stopHint = document.querySelector('.stop-hint');

// 3.0 UI 元素
const canvasVisualizer = document.getElementById('audio-visualizer');
const canvasCtx = canvasVisualizer.getContext('2d');
const historyListContainer = document.getElementById('history-list');
const btnShare = document.getElementById('btn-share');
const btnShareLine = document.getElementById('btn-share-line');
const btnShareFb = document.getElementById('btn-share-fb');
const btnRefineMic = document.getElementById('btn-refine-mic');
const liveTranscriptBox = document.getElementById('live-transcript');
const langSelect = document.getElementById('select-lang');
const inputRefine = document.getElementById('input-refine');
const inputInitial = document.getElementById('input-initial');
const btnRefine = document.getElementById('btn-refine');
const resultContent = document.getElementById('result-content');

const btnCopy = document.getElementById('btn-copy');
const btnRedo = document.getElementById('btn-redo');

const modalSettings = document.getElementById('modal-settings');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnClearHistory = document.getElementById('btn-clear-history');
const inputApiKey = document.getElementById('input-api-key');
const inputVocab = document.getElementById('input-vocab');

const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIcon = toast.querySelector('i');

// -------------------------
// 狀態變數
// -------------------------
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingStartTime = 0;
let currentContext = 'default';

// --- 新增 API 防護相關狀態 ---
let isProcessing = false;
let currentAbortController = null;

/**
 * 統一控制全域 UI 是否進入「處理中」鎖定狀態
 */
function setUIProcessing(active) {
    isProcessing = active;
    
    // 禁用主要互動按鈕
    btnRecord.disabled = active;
    btnRefine.disabled = active;
    if (btnRefineMic) btnRefineMic.disabled = active;
    btnRedo.disabled = active;
    
    // 禁用情境 Tabs
    tabBtns.forEach(btn => btn.disabled = active);
    
    // 禁用選單與輸入框
    langSelect.disabled = active;
    inputInitial.disabled = active;
    inputRefine.disabled = active;

    // 視覺回饋：處理中時稍微調暗主區域並防止點擊
    const mainContent = document.querySelector('main');
    if (mainContent) {
        mainContent.style.opacity = active ? '0.7' : '1';
        mainContent.style.pointerEvents = active ? 'none' : 'auto';
    }
}

/**
 * 安全的 Gemini API Fetcher：支援 AbortSignal、自動重試與 429 友善提示
 */
async function safeFetchGemini(url, body, signal, maxRetries = 3) {
    const retryDelay = 2000;
    let lastError = null;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: signal
            });

            // 處理 429 頻率限制
            if (response.status === 429) {
                if (i < maxRetries - 1) {
                    showToast(`AI 目前太忙了，正在自動重試中... (${i + 1}/${maxRetries}) ☕`, 'success');
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                } else {
                    throw new Error('QUOTA_EXCEEDED');
                }
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || 'API 請求失敗');
            }

            return await response.json();

        } catch (err) {
            if (err.name === 'AbortError') throw err; // 被手動取消則直接拋出
            lastError = err;
            
            // 只有特定網路錯誤才進行重試，其餘或最後一次則拋出
            if (i < maxRetries - 1 && err.message !== 'QUOTA_EXCEEDED') {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                break;
            }
        }
    }
    throw lastError;
}

// LocalStorage Utils
const loadApiKey = () => localStorage.getItem('GEMINI_API_KEY') || '';
const saveApiKey = (key) => localStorage.setItem('GEMINI_API_KEY', key);
const loadVocab = () => localStorage.getItem('TYPELESS_VOCAB') || '';
const saveVocab = (text) => localStorage.setItem('TYPELESS_VOCAB', text);

// -------------------------
// 3.0 Draft History (歷史陣列處理)
// -------------------------
function getHistory() {
    try { return JSON.parse(localStorage.getItem('TYPELESS_HISTORY')) || []; } 
    catch(e) { return []; }
}
function saveDraftToHistory(context, rawText) {
    const history = getHistory();
    const dateStr = new Date().toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const excerpt = rawText.substring(0, 40).replace(/[#*`]/g, '').trim() + '...';
    
    // 預防空內容被存入
    if(rawText.length < 5) return; 

    history.unshift({ id: Date.now(), date: dateStr, context, raw: rawText, excerpt });
    if(history.length > 5) history.pop(); // 最高保留 5 筆
    
    localStorage.setItem('TYPELESS_HISTORY', JSON.stringify(history));
    renderHistory();
}

const contextLabels = { 'default': '預設', 'notes': '筆記', 'email': 'Email', 'social': '社群' };

function renderHistory() {
    const history = getHistory();
    historyListContainer.innerHTML = '';
    
    if (history.length === 0) {
        historyListContainer.innerHTML = '<div class="history-empty">尚無歷史紀錄</div>';
        return;
    }
    
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-header">
                <span style="color:var(--neon-blue)">${contextLabels[item.context] || '預設'}</span>
                <span>${item.date}</span>
            </div>
            <div class="history-excerpt">${item.excerpt}</div>
        `;
        div.addEventListener('click', () => {
            resultContent.innerHTML = marked.parse(item.raw);
            resultContent.dataset.raw = item.raw;
            switchView('result');
        });
        historyListContainer.appendChild(div);
    });
}
// 初始載入歷史紀錄
renderHistory();

// -------------------------
// UI 控制與過渡
// -------------------------
function switchView(viewName) {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    
    // 初始化分享按鈕 (3.0 API)
    if (viewName === 'result') {
        if (navigator.share) btnShare.classList.remove('hidden');
        inputRefine.value = ''; // 清空指令框
    } else if (viewName === 'process') {
        processTitle.textContent = 'AI 整理中...';
        processDesc.textContent = '正在分析意圖並依情境重新排版';
    }
}

function showToast(message, type = 'error') {
    toastMessage.textContent = message;
    if (type === 'success') {
        toast.style.background = 'rgba(22, 163, 74, 0.9)';
        toastIcon.className = 'ph ph-check-circle';
    } else {
        toast.style.background = 'rgba(220, 38, 38, 0.9)';
        toastIcon.className = 'ph ph-warning-circle';
    }
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// -------------------------
// 3.0 Audio Visualizer 視覺化音頻
// -------------------------
let audioCtx, analyser, dataArray, visualizerReqAF;

function initVisualizer(stream) {
    if(!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 64; // 低解析度以達到柔和效果
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    drawVisualizer();
}

function drawVisualizer() {
    if(!isRecording) {
        canvasCtx.clearRect(0, 0, canvasVisualizer.width, canvasVisualizer.height);
        return;
    }
    visualizerReqAF = requestAnimationFrame(drawVisualizer);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.clearRect(0, 0, canvasVisualizer.width, canvasVisualizer.height);

    const centerX = canvasVisualizer.width / 2;
    const centerY = canvasVisualizer.height / 2;
    
    // 計算平均頻率
    let sum = 0;
    for(let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    let avg = sum / dataArray.length;

    // 半徑跳動範圍 (按鈕半徑約 45px，canvas 是 200x200，最大約 90px)
    const baseRadius = 50;
    const dynamicRadius = baseRadius + (avg / 255) * 45;

    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, dynamicRadius, 0, 2 * Math.PI, false);
    
    canvasCtx.lineWidth = 4;
    canvasCtx.strokeStyle = `rgba(0, 240, 255, ${Math.min(1, avg/50 + 0.2)})`;
    canvasCtx.shadowColor = '#8a2be2';
    canvasCtx.shadowBlur = 20;
    canvasCtx.stroke();
    canvasCtx.closePath();
}

function stopVisualizer() {
    if(visualizerReqAF) cancelAnimationFrame(visualizerReqAF);
    canvasCtx.clearRect(0, 0, canvasVisualizer.width, canvasVisualizer.height);
}

// -------------------------
// 情境 Tabs 邏輯
// -------------------------
tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (isProcessing) return; // 處裡中不允許重複點擊

        tabBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentContext = e.target.dataset.context;

        // 4.5 混合處理：如果初始文字區有內容，點擊 Tab 立即開始改寫
        const initialText = inputInitial.value.trim();
        if (initialText) {
            const contextLabel = contextLabels[currentContext] || '預設';
            const instruction = `將這段文字重新排版為「${contextLabel}」風格。`

            // 如果已有進行中的請求，立即取消它，避免浪費配額
            if (currentAbortController) {
                currentAbortController.abort();
            }

            refineExistingText(initialText, instruction);
        }
    });
});

/**
 * 4.5 針對既有文字進行改寫 (非疊代修正，而是初始文字區的風格轉換)
 */
async function refineExistingText(text, instruction) {
    const apiKey = loadApiKey();
    if (!apiKey) {
        showToast('請先設定 Gemini API Key');
        return;
    }

    setUIProcessing(true); // 鎖定 UI
    currentAbortController = new AbortController(); // 建立新的取消控制器

    processTitle.textContent = 'AI 風格轉換中...';
    processDesc.textContent = `正將既有文字轉換為「${contextLabels[currentContext]}」情境`;
    switchView('process');

    const targetOutputLang = langSelect.options[langSelect.selectedIndex].text;
    const vocab = loadVocab();
    const vocabInstruction = vocab ? `\n【優先術語】：[ ${vocab} ]` : "";

    const promptText = `你是一個專業的文案編輯。以下是一段既有的文字：
---
${text}
---
請幫我執行以下任務：
1. 【風格修改】：${instruction}
2. 【語言目標】：確保最終輸出為「${targetOutputLang}」。
3. 【修正】：去除贅詞並優化流暢度。${vocabInstruction}

請直接輸出最終排版好的 Markdown 内容，不要有任何多餘解釋。`;

    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const requestBody = {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.1 }
        };

        const data = await safeFetchGemini(apiUrl, requestBody, currentAbortController.signal);
        const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!result) throw new Error('無法擷取回覆');

        resultContent.innerHTML = marked.parse(result);
        resultContent.dataset.raw = result;
        saveDraftToHistory(currentContext, result);
        switchView('result');
        showToast('風格轉換完成！', 'success');
    } catch (err) {
        if (err.name === 'AbortError') return; // 被取消則靜默退出
        console.error(err);
        if (err.message === 'QUOTA_EXCEEDED') {
            showToast('AI 目前太忙了，請稍等一分鐘再試試看喔！☕');
        } else {
            showToast('轉換失敗，請檢查網路或 API Key');
        }
        switchView('record');
    } finally {
        setUIProcessing(false); // 解除 UI 鎖定
    }
}

// -------------------------
// 設定 Modal 邏輯與 4.0 歷史清空
// -------------------------
btnOpenSettings.addEventListener('click', () => {
    inputApiKey.value = loadApiKey();
    inputVocab.value = loadVocab();
    modalSettings.classList.remove('hidden');
});

btnCloseSettings.addEventListener('click', () => {
    modalSettings.classList.add('hidden');
});

btnClearHistory.addEventListener('click', () => {
    if(confirm('確定要清空所有存在本機的打字紀錄嗎？清空後無法復原。')) {
        localStorage.removeItem('TYPELESS_HISTORY');
        renderHistory();
        showToast('歷史紀錄已清空', 'success');
        modalSettings.classList.add('hidden');
    }
});

btnSaveSettings.addEventListener('click', () => {
    const key = inputApiKey.value.trim();
    const vocab = inputVocab.value.trim();
    if (key) {
        saveApiKey(key);
        saveVocab(vocab);
        modalSettings.classList.add('hidden');
        showToast('設定已儲存 (本機)', 'success');
    } else { showToast('API Key 不能為空'); }
});

modalSettings.addEventListener('click', (e) => {
    if (e.target === modalSettings) modalSettings.classList.add('hidden');
});

// -------------------------
// 計時器邏輯
// -------------------------
function startTimer() {
    recordingStartTime = Date.now();
    timerDisplay.classList.add('visible');
    stopHint.classList.add('visible');
    recordingInterval = setInterval(() => {
        const diff = Math.floor((Date.now() - recordingStartTime) / 1000);
        const mins = String(Math.floor(diff / 60)).padStart(2, '0');
        const secs = String(diff % 60).padStart(2, '0');
        timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(recordingInterval);
    timerDisplay.classList.remove('visible');
    stopHint.classList.remove('visible');
    timerDisplay.textContent = '00:00';
}

// -------------------------
// 4.0 即時字卡預覽 (Web Speech API)
// -------------------------
let liveRecognizer = null;
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    liveRecognizer = new SpeechRecognition();
    liveRecognizer.lang = 'zh-TW'; // 錄音端一律為台灣國語/中文輸入
    liveRecognizer.continuous = true;
    liveRecognizer.interimResults = true;

    liveRecognizer.onresult = (e) => {
        let transcript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            transcript += e.results[i][0].transcript;
        }
        liveTranscriptBox.textContent = transcript;
    };
    liveRecognizer.onerror = (e) => { console.warn('即時預覽錯誤', e.error); };
}

// -------------------------
// 錄音核心邏輯
// -------------------------
async function startRecording() {
    const apiKey = loadApiKey();
    if (!apiKey) {
        showToast('請先於右上角設定 Gemini API Key');
        modalSettings.classList.remove('hidden');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { autoGainControl: true, noiseSuppression: true, echoCancellation: true } 
        });
        
        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4'; 

        mediaRecorder = new MediaRecorder(stream, { mimeType });
        audioChunks = [];

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            stream.getTracks().forEach(track => track.stop());
            stopVisualizer();
            
            if(liveRecognizer) {
                liveRecognizer.stop();
                liveTranscriptBox.classList.add('hidden');
            }

            switchView('process');
            await processAudioWithGemini(audioBlob, mediaRecorder.mimeType);
        };

        initVisualizer(stream); // 啟動視覺化
        
        if(liveRecognizer) {
            liveTranscriptBox.textContent = '... 開始聆聽 ...';
            liveTranscriptBox.classList.remove('hidden');
            try { liveRecognizer.start(); } catch(e){}
        }

        mediaRecorder.start();
        isRecording = true;
        
        btnRecord.classList.add('recording');
        btnRecord.innerHTML = '<i class="ph ph-stop"></i>';
        recordPulse.classList.add('active');
        startTimer();

    } catch (err) {
        console.error(err);
        showToast('無法取得麥克風權限，請確認瀏覽器設定。');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
        
        if(liveRecognizer) liveRecognizer.stop();

        btnRecord.classList.remove('recording');
        btnRecord.innerHTML = '<i class="ph ph-microphone"></i>';
        recordPulse.classList.remove('active');
        stopTimer();
    }
}

btnRecord.addEventListener('click', () => {
    if (!isRecording) startRecording();
    else stopRecording();
});

// -------------------------
// Gemini API 處理 (多模態音訊上傳)
// -------------------------
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function processAudioWithGemini(blob, mimeType) {
    const apiKey = loadApiKey();
    const initialText = inputInitial.value.trim();
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    setUIProcessing(true);
    currentAbortController = new AbortController();

    try {
        const base64Audio = await blobToBase64(blob);
        const cleanMimeType = mimeType.split(';')[0];
        
        const vocab = loadVocab();
        const targetOutputLang = langSelect.options[langSelect.selectedIndex].text;
        
        let contextInstruction = "";
        if (currentContext === 'email') {
            contextInstruction = "請以「商務 Email」格式整理，語氣正式且層次清晰。";
        } else if (currentContext === 'social') {
            contextInstruction = "請以「社群貼文 (IG/FB)」風格整理，加入表情符號，語氣親切有活力。";
        } else if (currentContext === 'notes') {
            contextInstruction = "請以「重點筆記」格式整理，運用列點 (Bullet Points) 提煉精華。";
        } else {
            contextInstruction = "請進行「自動排版」，確保語意流暢且易於閱讀。";
        }

        const vocabInstruction = vocab ? `\n【優先術語】：[ ${vocab} ]` : "";

        let finalPromptText = "";
        if (initialText) {
            finalPromptText = `你是一個專業的 AI 編輯與寫作助手。目前已有一段既有文字：
---
${initialText}
---
現在講者又錄了一段語音補充。請聆聽音訊，並將語音內容「智慧整合」進上述既有文字中。
你的目標是：
1. 【整合與續寫】：根據語音內容，決定是追加在末尾、修改既有段落，還是根據語音指令進行編輯。
2. 【情境風格】：${contextInstruction}
3. 【語言目標】：最終輸出必須為「${targetOutputLang}」。
4. 【修正】：去除贅詞，優化流暢度。${vocabInstruction}

請直接輸出最終整合後的 Markdown 內容，不要有任何多餘解釋或對話。`;
        } else {
            finalPromptText = `你是一個專業的語音寫作助理。請聆聽附帶的音訊，將其轉錄為文字，並嚴格遵循以下規則：
1. 【跨語種翻譯與輸出目標】：徹底理解講者的意圖與語義後，確保最終輸出成「${targetOutputLang}」！
2. 【情境風格】：${contextInstruction}
3. 【修正】：去除贅詞，修正自我重複，提取最終意圖。${vocabInstruction}

請直接輸出最終排版好的 Markdown 內容，不要有任何多餘解釋或對話。`;
        }

        const requestBody = {
            contents: [{ parts: [ { text: finalPromptText }, { inline_data: { mime_type: cleanMimeType, data: base64Audio } } ] }],
            generationConfig: { temperature: 0.1 } 
        };

        const data = await safeFetchGemini(apiUrl, requestBody, currentAbortController.signal);
        const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!textResult) throw new Error('無法擷取文字結果');

        resultContent.innerHTML = marked.parse(textResult);
        resultContent.dataset.raw = textResult;
        saveDraftToHistory(currentContext, textResult);
        switchView('result');

    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error(error);
        if (error.message === 'QUOTA_EXCEEDED') {
            showToast('AI 目前太忙了，請稍等一分鐘再試試看喔！☕');
        } else {
            showToast('處理音訊時發生錯誤，請檢查網路或金鑰');
        }
        switchView('record');
    } finally {
        setUIProcessing(false);
    }
}

// -------------------------
// 3.0 Voice Refinement 疊代修正邏輯
// -------------------------
async function refineWithGemini(instruction) {
    const apiKey = loadApiKey();
    if (!apiKey) return;
    
    setUIProcessing(true);
    currentAbortController = new AbortController();

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const oldContent = resultContent.dataset.raw;
    
    // 切換 UI，這次只用文字 API
    processTitle.textContent = 'AI 二次打磨中...';
    processDesc.textContent = `正依照「${instruction}」調整文字`;
    switchView('process');

    const promptText = `這是一段先前已經整理好的文稿：
----------------
${oldContent}
----------------
請作為一位專業的文案助理，幫我修改這段文稿。
我的要求是：「${instruction}」

請確保完全遵循我的要求，並且直接輸出修改後的最完美結果（使用 Markdown 格式），不要加入任何開頭結尾的寒暄與解釋。確保輸出的文字為台灣繁體中文 (zh-TW)。`;

    const requestBody = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.3 }
    };

    try {
        const data = await safeFetchGemini(apiUrl, requestBody, currentAbortController.signal);
        const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResult) throw new Error('無法擷取回覆');
        
        resultContent.innerHTML = marked.parse(textResult);
        resultContent.dataset.raw = textResult;
        
        saveDraftToHistory(currentContext, textResult);
        switchView('result');
        showToast('已完成指令修改！', 'success');
        
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error(err);
        if (err.message === 'QUOTA_EXCEEDED') {
            showToast('AI 目前太忙了，請稍等一分鐘再試試看喔！☕');
        } else {
            showToast('修改發生錯誤，其檢查網路或 API Key');
        }
        switchView('result'); 
    } finally {
        setUIProcessing(false);
    }
}

btnRefine.addEventListener('click', () => {
    const instruction = inputRefine.value.trim();
    if(instruction) refineWithGemini(instruction);
});

inputRefine.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') {
        const instruction = inputRefine.value.trim();
        if(instruction) refineWithGemini(instruction);
    }
});

// -------------------------
// 疊代修正 語音輸入 (Web Speech API)
// -------------------------
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = true;
    
    let isRecognizing = false;

    btnRefineMic.addEventListener('click', () => {
        if (isRecognizing) {
            recognition.stop();
        } else {
            inputRefine.value = '';
            recognition.start();
        }
    });

    recognition.onstart = () => {
        isRecognizing = true;
        btnRefineMic.innerHTML = '<i class="ph ph-stop-circle"></i>';
        btnRefineMic.style.color = 'var(--neon-pink)';
        inputRefine.placeholder = '聆聽中... 請說出修改指令';
    };

    recognition.onresult = (e) => {
        let transcript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            transcript += e.results[i][0].transcript;
        }
        inputRefine.value = transcript;
    };

    recognition.onend = () => {
        isRecognizing = false;
        btnRefineMic.innerHTML = '<i class="ph ph-microphone"></i>';
        btnRefineMic.style.color = '';
        inputRefine.placeholder = '需要修改嗎？打字或點擊左側麥克風語音輸入...';
    };

    recognition.onerror = (e) => {
        console.error('語音辨識錯誤', e.error);
        if (e.error === 'not-allowed') showToast('請允許麥克風權限以使用語音輸入。');
        isRecognizing = false;
        btnRefineMic.innerHTML = '<i class="ph ph-microphone"></i>';
        btnRefineMic.style.color = '';
    };
} else {
    if(btnRefineMic) btnRefineMic.style.display = 'none';
}

// -------------------------
// 結果區互動 (Copy, Share)
// -------------------------
btnCopy.addEventListener('click', () => {
    const text = resultContent.dataset.raw;
    if (text) {
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = btnCopy.innerHTML;
            btnCopy.innerHTML = '<i class="ph ph-check"></i><span>已複製!</span>';
            setTimeout(() => btnCopy.innerHTML = originalHTML, 2000);
        }).catch(err => { showToast('複製失敗'); });
    }
});

// 3.0 直觀分享按鈕 (LINE & FB)
btnShareLine.addEventListener('click', () => {
    const text = resultContent.dataset.raw;
    if (text) {
        const url = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    }
});

btnShareFb.addEventListener('click', () => {
    const text = resultContent.dataset.raw;
    if (text) {
        // 注意: FB 主要分享的是網址，我們強制帶入目前的本地端網址與引文
        const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}&quote=${encodeURIComponent(text)}`;
        window.open(url, '_blank', 'width=600,height=500,scrollbars=yes');
    }
});

// 3.0 Web Share API 整合 (原生更多分享選單)
btnShare.addEventListener('click', async () => {
    const text = resultContent.dataset.raw;
    if (navigator.share && text) {
        try {
            await navigator.share({
                title: 'Typeless AI 的排版筆記',
                text: text
            });
            showToast('已開啟分享', 'success');
        } catch (err) {
            console.log('分享取消或失敗', err);
        }
    }
});

btnRedo.addEventListener('click', () => {
    resultContent.innerHTML = '';
    resultContent.dataset.raw = '';
    switchView('record');
});

// -------------------------
// PWA Service Worker 註冊
// -------------------------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(reg => {
            console.log('SW registered:', reg.scope);
        }).catch(err => {
            console.log('SW registration failed:', err);
        });
    });
}
