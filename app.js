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
        tabBtns.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentContext = e.target.dataset.context;
    });
});

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
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    try {
        const base64Audio = await blobToBase64(blob);
        const cleanMimeType = mimeType.split(';')[0];
        
        const vocab = loadVocab();
        const targetOutputLang = langSelect.options[langSelect.selectedIndex].text; // 取得選定的目標語言
        
        let tonePart = "4. 【自動排版】：若句子較長或有多個重點，請自動理解意圖，排版為易讀的段落或條列式清單（Markdown 格式）。";
        
        if (currentContext === 'email') {
            tonePart = "4. 【商務 Email】：請將內容整理為一封「正式的商務 Email」格式。語氣需正式、禮貌且層次清晰。";
        } else if (currentContext === 'social') {
            tonePart = "4. 【社群貼文】：請將內容整理為適合發佈在「社群平台 (IG/Threads/FB)」的貼文。語氣輕鬆有人味，加上適當表情符號。";
        } else if (currentContext === 'notes') {
            tonePart = "4. 【重點筆記】：請運用「列點 (Bullet Points)」將內容提煉為結構清晰、層次分明的重點筆記。";
        }

        const vocabInstruction = vocab ? `\n5. 【自訂專有名詞/術語】：講者可能會提到以下專屬名詞，請務必優先使用以下正確用詞：[ ${vocab} ]` : "";

        // 4.0 加入翻譯目標指令
        const finalPromptText = `你是一個專業的語音寫作助理。請聆聽附帶的音訊，將其轉錄為文字，並嚴格遵循以下規則：
1. 【跨語種翻譯與輸出目標】：請徹底理解講者的意圖與語義後，**絕對確保最終輸出成「${targetOutputLang}」這門語言！** 若是美式英文請用專業道地的詞彙，若是日文韓文請用有禮貌的敬體，若是繁體中文請用台灣道地的習慣用語與時事詞彙。(不要加上額外的寒暄)
2. 【去除贅詞】：刪除所有口語贅詞與無意義的發音。
3. 【自我修正處理】：講者如果在語音中有自我修正或改口重講，請提取最終想表達的意思。
${tonePart}${vocabInstruction}

請直接輸出最終排版修正並翻譯好的精美內容（使用 Markdown），絕對不要輸出任何多餘的解釋或對話。`;

        const requestBody = {
            contents: [{ parts: [ { text: finalPromptText }, { inline_data: { mime_type: cleanMimeType, data: base64Audio } } ] }],
            generationConfig: { temperature: 0.1 } 
        };

        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });

        if (!response.ok) throw new Error('API 請求失敗');

        const data = await response.json();
        const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!textResult) throw new Error('無法擷取文字結果');

        // 更新 UI 與存入歷史
        resultContent.innerHTML = marked.parse(textResult);
        resultContent.dataset.raw = textResult;
        saveDraftToHistory(currentContext, textResult);
        switchView('result');

    } catch (error) {
        console.error(error);
        showToast('處理音訊時發生錯誤，請再試一次');
        switchView('record');
    }
}

// -------------------------
// 3.0 Voice Refinement 疊代修正邏輯
// -------------------------
async function refineWithGemini(instruction) {
    const apiKey = loadApiKey();
    if (!apiKey) return;
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { temperature: 0.3 }
            })
        });
        
        if (!response.ok) throw new Error('修改失敗');
        
        const data = await response.json();
        const textResult = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResult) throw new Error('無法擷取回覆');
        
        resultContent.innerHTML = marked.parse(textResult);
        resultContent.dataset.raw = textResult;
        
        // 將修改後的結果也作為新的一筆存入歷史
        saveDraftToHistory(currentContext, textResult);
        switchView('result');
        showToast('已完成指令修改！', 'success');
        
    } catch (err) {
        console.error(err);
        showToast('修改發生錯誤，請重試');
        switchView('result'); // 退回展示頁免得跑不出來
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
