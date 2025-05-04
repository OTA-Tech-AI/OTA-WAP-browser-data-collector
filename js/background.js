(function () {
    "use strict";

	const taskIdMap = {};
	const lastPageGoToTimestamps = {};
	let cachedCollectorURL = null;

	function generateTaskId() {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
					+ 'abcdefghijklmnopqrstuvwxyz'
					+ '0123456789';
		let id = '';
		for (let i = 0; i < 16; i++) {
		  id += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return id;
	}

	function getCollectorURL() {
	  if (cachedCollectorURL) return Promise.resolve(cachedCollectorURL);
	
	  return new Promise((resolve) => {
		chrome.storage.sync.get(
		  { collectorHost: '127.0.0.1', collectorPort: 4934 },
		  ({ collectorHost, collectorPort }) => {
			cachedCollectorURL = `http://${collectorHost}:${collectorPort}/action-data`;
			resolve(cachedCollectorURL);
		  }
		);
	  });
	}
	
	function sendDataToCollectorServer(payload) {
	  return getCollectorURL()
		.then((url) => {
			console.log(url)
		  return fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			keepalive: true              // allow send during service‑worker shutdown
		  });
		})
		.then(async (resp) => {
		  const json = await resp.json().catch(() => ({}));
		  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		  console.log('[OTA DOM Background] sent OK:', json);
		  return json;
		})
		.catch((err) => {
		  console.error('[OTA DOM Background] send failed:', err);
		  // Re‑throw so callers can handle if they want
		  throw err;
		});
	}

    chrome.runtime.onConnect.addListener(function (port) {
        if (port.name === 'devtools-page') {
            handleDevToolsConnection(port);
        } else if (port.name === 'content-script') {
            handleContentScriptConnection(port);
        }
    });

    var devToolsPorts = {};
    var contentScriptPorts = {};
	const pageContentStore = {};

    function handleDevToolsConnection(port) {
        var tabId;

        var messageListener = function (message, sender, sendResponse) {
            console.log('[OTA DOM Background]: devtools panel', message, sender);

            if (message.type === 'inject') {
                tabId = message.tabId;
                devToolsPorts[tabId] = port;

				chrome.scripting.executeScript({
					target: { tabId: message.tabId },
					files: [message.scriptToInject]
				}, (injectionResults) => {
					if (chrome.runtime.lastError) {
						console.log('[OTA DOM Background]: Error injecting script', chrome.runtime.lastError);
					} else {
						console.log('[OTA DOM Background]: Script injected successfully', injectionResults);
					}
				});
            } else {
                //pass message from DevTools panel to a content script
                if (contentScriptPorts[tabId]) {
                    contentScriptPorts[tabId].postMessage(message);
                }
            }
        };

        port.onMessage.addListener(messageListener);

        port.onDisconnect.addListener(function () {
            devToolsPorts[tabId] = undefined;
            contentScriptPorts[tabId] = undefined;
            port.onMessage.removeListener(messageListener);
        });
    }

    function handleContentScriptConnection(port) {
        var tabId = port.sender.tab.id;

        contentScriptPorts[tabId] = port;

        var messageListener = function (message, sender, sendResponse) {
            console.log('[OTA DOM Background]: content script status: ', message.type, ', tab ID: ', tabId);

            //pass message from content script to the appropriate DevTools panel
            if (devToolsPorts[tabId]) {
                devToolsPorts[tabId].postMessage(message);
            }
        };

        port.onMessage.addListener(messageListener);

        port.onDisconnect.addListener(function () {
            port.onMessage.removeListener(messageListener);

            //let devtools panel know that content script has disconnected
            if (devToolsPorts[tabId]) {
                devToolsPorts[tabId].postMessage({
                    type: 'disconnected'
                });
            }
        });
    }

	chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
		if (message.type === 'send-summary-event' ||
			message.type === 'submit') {
			sendDataToCollectorServer(message.summaryEvent);
			return true;
		}
		else if (message.type === 'input-value-changed'){
			const tabId = sender.tab.id;
			const lastTimestamp = lastPageGoToTimestamps[tabId];
			const summaryEvent = message.summaryEvent;
			const currentTimestamp = summaryEvent.actionTimestamp;
			if (currentTimestamp - lastTimestamp < 500) { // if less than 500 ms passed, ignore duplicate
				console.log(`[OTA DOM Background]: input blur after clicking on link, ignored for tab ${tabId}`);
				return false;
			}
			sendDataToCollectorServer(message.summaryEvent);
			return true;
		} else if (message.type === 'collector-settings-updated') {
			cachedCollectorURL = null;
			console.log('[OTA DOM Background] cache cleared after settings update');
		  }
	});	

	chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
		if (message.type === 'page-go-to') {
			const tabId = sender.tab.id;
			const clickData = message.clickData;

			if (clickData && clickData.actionTimestamp) {
				const currentTimestamp = clickData.actionTimestamp;
				// Check if we already processed a click in this tab recently

				if (lastPageGoToTimestamps[tabId] !== undefined) {
				  const lastTimestamp = lastPageGoToTimestamps[tabId];
				  if (currentTimestamp - lastTimestamp < 500) { // if less than 100 ms passed, ignore duplicate
					console.log(`[OTA DOM Background]: Duplicate click data ignored for tab ${tabId}`);
					return false;
				  }
				}
				// Update the last click timestamp for the tab.
				lastPageGoToTimestamps[tabId] = currentTimestamp;
			}
			sendDataToCollectorServer(clickData);
			return true;
		}
		// Return false if no asynchronous response is needed.
		return false;
	});

	chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
		switch (message.type) {
		  case 'update-page-content': {
			const tabId = sender.tab.id;
			pageContentStore[tabId] = message.sanitizedPageHTML;
			sendResponse({ status: 'success', taskId: taskIdMap[tabId] });
			break;
		  }
		  case 'delete-page-content': {
			const tabId = sender.tab.id;
			delete pageContentStore[tabId];
			console.log(`[OTA DOM Background]: Delete page content for tab ${tabId}`);
			sendResponse({ status: 'success' });
			break;
		  }
		  case 'task-start': {
			const tabId = sender.tab.id;
			const newId = generateTaskId();
			taskIdMap[tabId]      = newId;
			console.log("2213421312");
			pageContentStore[tabId] = message.summaryEvent.pageHTMLContent;
			message.summaryEvent.taskId = newId;
			sendDataToCollectorServer(message.summaryEvent);
			sendResponse({ status: 'success', taskId: newId });
			break;
		  }
		  case 'task-finish': {
			const tabId = sender.tab.id;
			sendDataToCollectorServer(message.summaryEvent);
			delete taskIdMap[tabId];
			sendResponse({ status: 'success' });
			break;
		  }
		  case 'get-task-id': {
			const tabId = message.tabId;
			sendResponse({ status: 'success', taskId: taskIdMap[tabId] });
			break;
		  }
		  default:
			break;
		}
		return false;
	  });

	chrome.tabs.onRemoved.addListener(function(tabId) {
		delete pageContentStore[tabId];
		delete taskIdMap[tabId];
	});

	chrome.webNavigation.onCommitted.addListener(function(details) {
		const tabId = details.tabId;

		// if we don't find the pageContentStore for current tabId, it means
		// users do not switch on the recording, so ignore this action
		if(!pageContentStore[tabId]){ return false; }

		// Optionally, determine if this navigation was caused by a back button
		if (details.transitionQualifiers && details.transitionQualifiers.includes('forward_back')) {
			console.log("[OTA DOM Background]: GO BACK or GO FORWARD navigation detected in tab:", tabId);
			var summaryEvent = {
				taskId: taskIdMap[tabId],
				type: "go-back-or-forward",
				actionTimestamp: Date.now(),
				eventTarget: {
					type: "navigation",
					target: details.url
				},
				allEvents: "",
				pageHTMLContent: pageContentStore[tabId]
			};
			sendDataToCollectorServer(summaryEvent);
		}
	  });

})();
