(function () {
    "use strict";

    var statusElem = document.querySelector('.status');
    var clearBtn = document.querySelector('.clear');
    var recordBtn = document.querySelector('.record');
	var pauseResumeBtn = document.querySelector('#record-pause-button-1');
    var topBtn = document.querySelector('.top');
    var table = document.querySelector('.events');
    var intro = document.querySelector('.intro');

    var scrollHelper = new ScrollHelper(topBtn);
    var eventTable = new EventTable(table);

    var recording = false;
	var paused = false;

	// Initially disable the Task Finish button
	pauseResumeBtn.disabled = true;

	function recordBtnHandler(){
        recording = !recording;
        recordBtn.innerText = recording ? 'Finish Record' : 'Start Record';
		pauseResumeBtn.disabled = !recording;

        if (recording) {
            ContentScriptProxy.startRecording();
        } else {
            ContentScriptProxy.finishRecording();
			paused = false;
			pauseResumeBtn.innerText = 'Pause';
        }

        if (intro.style.display !== 'none') {
            var player = intro.animate([
                {opacity: 1},
                {opacity: 0}
            ], 300);

            player.onfinish = function () {
                intro.style.display = 'none';
            };
        }
	}
    recordBtn.addEventListener('click', recordBtnHandler);

	pauseResumeBtn.addEventListener('click', function () {
		if (!recording) return;
		paused = !paused;
		pauseResumeBtn.innerText = paused ? 'Resume' : 'Pause';
		pauseResumeBtn.className = paused ? 'record-resume' : 'record-pause';
		if (paused) {
			ContentScriptProxy.pauseRecording();
        } else {
            ContentScriptProxy.resumeRecording();
        }
	});

    clearBtn.addEventListener('click', function () {
        eventTable.clear();
    });

    topBtn.addEventListener('click', function () {
        scrollHelper.scrollToTheTop();
    });

    // clicking on a node
    table.addEventListener('click', function (e) {
        var target = e.target;

        if (target && target.classList.contains('node') && target.dataset.nodeid) {
            if (e.shiftKey) {
                ContentScriptProxy.inspectNode(target.dataset.nodeid);
            } else {
                ContentScriptProxy.highlightNode(target.dataset.nodeid);
            }
        }
    });

    /**
     * BACKGROUND PAGE CONNECTION
     */

    function injectContentScript() {
        // Send the tab ID to the background page
        bgPageConnection.postMessage({
            type: 'inject',
            tabId: chrome.devtools.inspectedWindow.tabId,
            scriptToInject: "js/DOMListener.js"
        });
    }

    var bgPageConnection = chrome.runtime.connect({
        name: "devtools-page"
    });

    bgPageConnection.onMessage.addListener(function handleMessage(message) {
        if (message.type === 'connected') {
            statusElem.classList.add('connected');

            eventTable.clear();

            if (recording) {
                ContentScriptProxy.resumeRecording();
            }
        } else if (message.type === 'disconnected') {
            statusElem.classList.remove('connected');

            injectContentScript();
        } else if (message.type === 'event') {
            eventTable.addEvent(message.event);
        }
    });

    injectContentScript();
})();
