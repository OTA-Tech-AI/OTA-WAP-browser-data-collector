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

    var recording = false;
	var paused = false;
	var taskId = "";

	// Initially disable the Task Finish button
	pauseResumeBtn.disabled = true;

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
			  taskId = response.taskId;
			  taskIdDisplay.innerText = "ID: " + taskId;
		  });
	  }

	  function recordBtnHandler() {
		// ======= RECORDING START =======
		if (!recording) {
		  const desc = taskInput.value.trim();
		  /* 1. Block start if description empty */
		  if (!desc) {
			taskInput.classList.add('invalid');
			taskInput.focus();
			return;
		  }
		  taskInput.classList.remove('invalid');
	  
		  /* 2. Switch input → plain-text label */
		  showLabel(desc);
	  
		  /* 3. Begin recording */
		  ContentScriptProxy.startRecording(desc);
		  setTimeout(() => { getCurrentTaskId(); }, 1000);
		  recording = true;
		  paused    = false;
	  
		  /* 4. Update buttons */
		  recordBtn.innerText   = 'Finish Record';
		  pauseResumeBtn.disabled = false;
		  pauseResumeBtn.innerText = 'Pause';
	  
		  /* 5. Show the Hide/Show-Task toggle */
		  taskVisibilityBtn.hidden = false;
		  taskVisibilityBtn.innerText = 'Hide Task';
		  taskSection.style.display   = 'block';   // Task visible by default
		}
	  
		// ======= RECORDING FINISH =======
		else {
		  ContentScriptProxy.finishRecording();
		  taskIdDisplay.innerText = '...';
	  
		  /* 1. Restore input field */
		  showInput(true);            // clear value
		  recording = false;
		  paused    = false;
	  
		  /* 2. Update buttons */
		  recordBtn.innerText   = 'Start Record';
		  pauseResumeBtn.disabled = true;
		  pauseResumeBtn.innerText = 'Pause';
	  
		  /* 3. Hide the Hide/Show-Task toggle, always show task input */
		  taskVisibilityBtn.hidden = true;
		  taskSection.style.display = 'block';
		}
	  
		/* Optional intro fade-out (unchanged) */
		if (intro.style.display !== 'none') {
		  intro.animate([{ opacity: 1 }, { opacity: 0 }], 300)
			   .onfinish = () => intro.style.display = 'none';
		}
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
		if (!recording) return;
		paused = !paused;
		pauseResumeBtn.innerText = paused ? 'Resume' : 'Pause';
		pauseResumeBtn.classList.toggle('record-resume', paused);
		pauseResumeBtn.classList.toggle('record-pause',  !paused);	  
		if (paused) {
			ContentScriptProxy.pauseRecording();
        } else {
            ContentScriptProxy.resumeRecording(taskLabel.textContent);
			setTimeout(() => { getCurrentTaskId(); }, 1000);
        }
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

    var bgPageConnection = chrome.runtime.connect({
        name: "devtools-page"
    });

    bgPageConnection.onMessage.addListener(function handleMessage(message) {
        if (message.type === 'connected') {
            statusElem.classList.add('connected');

            eventTable.clear();

            if (recording) {
                ContentScriptProxy.resumeRecording(taskLabel.textContent);
				setTimeout(() => { getCurrentTaskId(); }, 1000);
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
