(async function () {
    "use strict";

    const statusElem = document.querySelector('.status');
    const clearBtn = document.querySelector('.clear');
    const recordBtn = document.querySelector('.record');
    const pauseResumeBtn = document.querySelector('#record-pause-button-1');
    const topBtn = document.querySelector('.top');
    const table = document.querySelector('.events');
    const intro = document.querySelector('.intro');

    const scrollHelper = new ScrollHelper(topBtn);
    const eventTable = new EventTable(table);

    let recording = false;
    let paused = false;
    let currentTabId = null;

    pauseResumeBtn.disabled = true;

    // 获取当前 tab ID
    async function getCurrentTabId() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0]?.id;
    }

    // 注入监听脚本
    async function injectContentScript() {
        if (!currentTabId) currentTabId = await getCurrentTabId();
        await chrome.scripting.executeScript({
            target: { tabId: currentTabId },
            files: ["js/DOMListener.js"]
        });
        console.log("Injected DOMListener.js");
    }

    // content script 控制接口
    const ContentScriptProxy = {
        async send(type, payload = {}) {
            if (!currentTabId) currentTabId = await getCurrentTabId();
            chrome.tabs.sendMessage(currentTabId, { type, ...payload });
        },
        startRecording() { this.send("startRecording"); },
        pauseRecording() { this.send("pauseRecording"); },
        resumeRecording() { this.send("resumeRecording"); },
        finishRecording() { this.send("finishRecording"); },
        highlightNode(nodeId) { this.send("highlightNode", { nodeId }); },
        inspectNode(nodeId) { this.send("inspectNode", { nodeId }); }
    };

    recordBtn.addEventListener('click', async () => {
        recording = !recording;
        recordBtn.innerText = recording ? 'Finish Record' : 'Start Record';
        pauseResumeBtn.disabled = !recording;

        if (recording) {
            await injectContentScript();
            ContentScriptProxy.startRecording();
        } else {
            ContentScriptProxy.finishRecording();
            paused = false;
            pauseResumeBtn.innerText = 'Pause';
        }

        if (intro.style.display !== 'none') {
            const player = intro.animate([{ opacity: 1 }, { opacity: 0 }], 300);
            player.onfinish = () => intro.style.display = 'none';
        }
    });

    pauseResumeBtn.addEventListener('click', () => {
        if (!recording) return;
        paused = !paused;
        pauseResumeBtn.innerText = paused ? 'Resume' : 'Pause';
        pauseResumeBtn.className = paused ? 'record-resume' : 'record-pause';
        paused ? ContentScriptProxy.pauseRecording() : ContentScriptProxy.resumeRecording();
    });

    clearBtn.addEventListener('click', () => eventTable.clear());
    topBtn.addEventListener('click', () => scrollHelper.scrollToTheTop());

    table.addEventListener('click', (e) => {
        const target = e.target;
        if (target?.classList.contains('node') && target.dataset.nodeid) {
            if (e.shiftKey) {
                ContentScriptProxy.inspectNode(target.dataset.nodeid);
            } else {
                ContentScriptProxy.highlightNode(target.dataset.nodeid);
            }
        }
    });

    // 监听从 content script 发来的事件数据
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "event") {
            statusElem?.classList.add('connected');
            eventTable.addEvent(message.event);
        }
    });

}

)();


