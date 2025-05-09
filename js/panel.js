(function () {
    "use strict";

    var statusElem = document.querySelector('.status');
    var clearBtn = document.querySelector('.clear');
    var recordBtn = document.querySelector('.record');
	var pauseResumeBtn = document.querySelector('#record-pause-button-1');
    var table = document.querySelector('.events');
    var intro = document.querySelector('.intro');

	var taskInput   = document.querySelector('.task-description-input');
	var taskIdDisplay   = document.querySelector('.task-description-task-id');
	var taskLabel   = document.querySelector('.task-description-label');
	var taskLabelStart   = document.querySelector('.task-description-start');
	var taskVisibilityBtn = document.querySelector('#task-visibility-toggle-button');
	var taskSection = document.querySelector('.task-description-section');

    var eventTable = new EventTable(table);

    // var recording = false;
	// var paused = false;
	// var taskId = "";

	// Initially disable the Task Finish button
	pauseResumeBtn.disabled = true;

	var settingsBtn      = document.querySelector('.settings-btn');
	var settingsPanel    = document.querySelector('.settings-panel');
	var hostField        = document.getElementById('collector-host');
	var portField        = document.getElementById('collector-port');
	var saveSettingsBtn  = document.getElementById('settings-save');
	var cancelSettingsBtn= document.getElementById('settings-cancel');
	var statusMsg        = document.getElementById('settings-status');
	var maskField = document.getElementById('collector-mask');

	function loadSettingsToUI() {
		try {
		  chrome.storage.sync.get(
			{ storedCollectorHost: '127.0.0.1', storedCollectorPort: 4934, maskSensitiveData:false },
			(cfg) => {
			  if (chrome.runtime?.id && document.isConnected) {
				hostField.value  = cfg.storedCollectorHost;
				portField.value  = cfg.storedCollectorPort;
				maskField.checked = !!cfg.maskSensitiveData;
			  }
			}
		  );
		} catch (e) {
		  // context was already destroyed – ignore
		}
	  }

	function saveSettingsFromUI() {
		const host = hostField.value.trim() || '127.0.0.1';
		const port = parseInt(portField.value, 10) || 4934;
		const mask = maskField.checked;
	  
		chrome.storage.sync.set(
		  {
			storedCollectorHost: host,
			storedCollectorPort: port,
			maskSensitiveData: mask
		  }
		);
	  }

	  function showSettingsPanel(show) {
		if (show) {
		  loadSettingsToUI();
		  settingsPanel.classList.remove('hidden');
		  document.querySelector('main').classList.add('hidden');
		  intro.style.display = 'none';
		} else {
		  settingsPanel.classList.add('hidden');
		  document.querySelector('main').classList.remove('hidden');
		  if(!recording){
			  intro.style.display = 'block';
		  }
		}
	  }

	  /* Open settings */
	  settingsBtn.addEventListener('click', () => showSettingsPanel(true));

	  /* Save & close */
	  saveSettingsBtn.addEventListener('click', () => {
		saveSettingsFromUI();
		showSettingsPanel(false);
	  });

	  /* Cancel just closes */
	  cancelSettingsBtn.addEventListener('click', () => showSettingsPanel(false));


	function showInput(clearValue = false) {
		if (clearValue) taskInput.value = '';
		taskInput.style.display = 'inline';
		taskLabel.style.display = 'none';
		taskIdDisplay.style.display = 'none';
		taskLabelStart.style.display = 'none';
	  }
	  
	  function showLabel(text) {
		taskLabel.textContent = text;
		taskInput.style.display = 'none';
		taskLabel.style.display = 'inline';
		taskIdDisplay.style.display = 'inline';
		taskLabelStart.style.display = 'inline';
	  }


	  taskInput.addEventListener('input', function() {
		this.style.height = 'auto';
		this.style.height = this.scrollHeight + 'px';
	  });

	  function getCurrentTaskId(){
		chrome.runtime.sendMessage({
			type: 'get-task-id',
			tabId: chrome.devtools.inspectedWindow.tabId
		  }, function(response) {

			 taskIdDisplay.innerText = "ID: " + (response.taskId || "...");
			 
		  });
	  }

	function syncUIWithRecordingState(state) {
		const { isRecording, isPaused, taskDescription, taskId } = state;
		
			if (isRecording) {
				showLabel(taskDescription || "(no description)");
				taskIdDisplay.innerText = "ID: " + (taskId || "...");
				recordBtn.innerText = 'Finish Record';
				pauseResumeBtn.disabled = false;
				pauseResumeBtn.innerText = isPaused ? 'Resume' : 'Pause';
				pauseResumeBtn.classList.toggle('record-resume', isPaused);
				pauseResumeBtn.classList.toggle('record-pause', !isPaused);
				taskVisibilityBtn.hidden = false;
				taskSection.style.display = 'block';
				intro.style.display = 'none';
			} else {
				showInput(true);
				recordBtn.innerText = 'Start Record';
				pauseResumeBtn.disabled = true;
				pauseResumeBtn.innerText = 'Pause';
				pauseResumeBtn.classList.remove('record-resume');
				pauseResumeBtn.classList.remove('record-pause');
				taskVisibilityBtn.hidden = true;
				taskSection.style.display = 'block';
				intro.style.display = 'block';
			}
	}
	

	function recordBtnHandler() {
		chrome.runtime.sendMessage({ type: 'get-recording-state' }, (resp) => {
			if (resp.status !== 'success') return;
			const { isRecording } = resp.state;
	
			// ======= RECORDING START =======
			if (!isRecording) {
				const desc = taskInput.value.trim();
				if (!desc) {
					taskInput.classList.add('invalid');
					taskInput.focus();
					return;
				}
				taskInput.classList.remove('invalid');
	
				showLabel(desc);
				ContentScriptProxy.startRecording(desc);
	
				// 设置 background 状态
				chrome.runtime.sendMessage({
					type: 'update-recording-state',
					isRecording: true,
					isPaused: false,
					taskDescription: desc
				});
	
				setTimeout(() => { getCurrentTaskId(); }, 1000);
	
			// ======= RECORDING FINISH =======
			} else {
				ContentScriptProxy.finishRecording();
	
				chrome.runtime.sendMessage({
					type: 'update-recording-state',
					isRecording: false,
					isPaused: false,
					taskId: null,
					taskDescription: ""
				});
	
				taskIdDisplay.innerText = '...';
				showInput(true);
				eventTable.clear();
	
				// Reset UI
				recordBtn.innerText = 'Start Record';
				pauseResumeBtn.disabled = true;
				pauseResumeBtn.innerText = 'Pause';
				pauseResumeBtn.classList.remove('record-resume');
				pauseResumeBtn.classList.remove('record-pause');
				taskVisibilityBtn.hidden = true;
				taskSection.style.display = 'block';
	
				intro.style.display = 'block';
				intro.style.opacity = 0;
				intro.animate([{ opacity: 0 }, { opacity: 1 }], 300)
					 .onfinish = () => (intro.style.opacity = 1);
			}
		});
	}
	
	
    recordBtn.addEventListener('click', recordBtnHandler);

	taskVisibilityBtn.addEventListener('click', function () {
		if (taskSection.style.display === 'none') {
			taskSection.style.display = 'block';
			taskVisibilityBtn.innerText = 'Hide Task';
		} else {
			taskSection.style.display = 'none';
			taskVisibilityBtn.innerText = 'Show Task';
		}
	});

	taskInput.addEventListener('input', () => {
		taskInput.classList.remove('invalid');
	});

	pauseResumeBtn.addEventListener('click', function () {
		chrome.runtime.sendMessage({ type: 'get-recording-state' }, (resp) => {
			if (resp.status !== 'success') return;
			const { isPaused, isRecording, taskDescription } = resp.state;
	
			if (!isRecording) return;
	
			const newPaused = !isPaused;
	
			if (newPaused) {
				ContentScriptProxy.pauseRecording();
			} else {
				ContentScriptProxy.resumeRecording(taskDescription);
				setTimeout(() => { getCurrentTaskId(); }, 1000);
			}
	
			chrome.runtime.sendMessage({
				type: 'update-recording-state',
				isPaused: newPaused
			});
		});
	});
	

    clearBtn.addEventListener('click', function () {
        eventTable.clear();
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

	// === Step 2: 初始化同步 recording 状态 ===
	chrome.runtime.sendMessage({ type: 'get-recording-state' }, (resp) => {
		if (resp.status === 'success') {
			const state = resp.state;
			syncUIWithRecordingState(state);
		} else {
			console.warn("[OTA Panel]: Failed to get recording state from background");
		}
	});


    var bgPageConnection = chrome.runtime.connect({
        name: "devtools-page"
    });

    bgPageConnection.onMessage.addListener(function handleMessage(message) {
        if (message.type === 'connected') {
            statusElem.classList.add('connected');

            eventTable.clear();

            chrome.runtime.sendMessage({ type: 'get-recording-state' }, (resp) => {
				if (resp.status === 'success' && resp.state.isRecording) {
					ContentScriptProxy.resumeRecording(resp.state.taskDescription);
					setTimeout(() => { getCurrentTaskId(); }, 1000);
				}
			});

        } else if (message.type === 'disconnected') {
            statusElem.classList.remove('connected');

            injectContentScript();
        } else if (message.type === 'event') {
            eventTable.addEvent(message.event);
        }
    });

    injectContentScript();
})();
