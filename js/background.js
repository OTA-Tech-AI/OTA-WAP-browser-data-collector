(function () {
    "use strict";


	function getTabIdPageSanitizedHTMLRequest(tabId){	
		// Send a message to the content script in this tab to get the page content.
		chrome.tabs.sendMessage(tabId, { type: 'get-page-content' }, function(response) {
			if (chrome.runtime.lastError) {
				console.error("Error retrieving page content:", chrome.runtime.lastError);
				return;
			}
			if (response && response.sanitizedPageHTML) {
				// return response.sanitizedPageHTML;
				pageContentStore[tabId] = response.sanitizedPageHTML;
				console.log("[OTA DOM Background]: Update finished on the content of page on tab ID: ", tabId);
			}
			// return null;
		});
	}

	function sendDataToCollectorServer(data){
		// Optionally send a response back.
		fetch('http://localhost:4934/action-data', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(data)
			})
			.then(response => response.json())
			.then(data => {
			console.log("[OTA DOM Background]: Data sent to server successfully:", data);
			})
			.catch(err => {
			console.error("[OTA DOM Background]: Error sending data to server:", err);
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

                chrome.tabs.executeScript(message.tabId, {
                    file: message.scriptToInject,
                    runAt: "document_start"
                }, function () {
                    if (chrome.runtime.lastError) {
                        console.log('[OTA DOM Background]: Error injecting script', chrome.runtime.lastError);
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
		if (message.type === 'send-summary-event') {
		  sendDataToCollectorServer(message.summaryEvent);
		  return true; // Keep the messaging channel open for asynchronous response.
		}
	});

	const lastPageGoToTimestamps = {};

	// Listen for messages from content scripts.
	chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
		if (message.type === 'page-go-to') {

			const tabId = sender.tab.id;
			const clickData = message.clickData;

			if (clickData && clickData.actionTimestamp) {
				const currentTimestamp = clickData.actionTimestamp;
				// Check if we already processed a click in this tab recently

				if (lastPageGoToTimestamps[tabId] !== undefined) {
				  const lastTimestamp = lastPageGoToTimestamps[tabId];

				  if (currentTimestamp - lastTimestamp < 100) { // if less than 100 ms passed, ignore duplicate
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

	chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
		if (message.type === 'update-page-content') {
			const tabId = sender.tab.id;
			pageContentStore[tabId] = message.sanitizedPageHTML;
			console.log(`[OTA DOM Background]: Updated page content for tab ${tabId}`);
			sendResponse({ status: 'success' });
		} else if (message.type === 'delete-page-content') {
			const tabId = sender.tab.id;
			delete pageContentStore[tabId];
			console.log(`[OTA DOM Background]: Delete page content for tab ${tabId}`);
			sendResponse({ status: 'success' });
		}
		return false;
	});

	chrome.tabs.onRemoved.addListener(function(tabId) {
		delete pageContentStore[tabId];
	});

	chrome.webNavigation.onCommitted.addListener(function(details) {
		const tabId = details.tabId;

		// if we don't find the pageContentStore for current tabId, it means
		// users do not switch on the recording, so ignore this action
		if(!pageContentStore[tabId]){
			return false;
		}
		// Optionally, determine if this navigation was caused by a back button
		if (details.transitionQualifiers && details.transitionQualifiers.includes('forward_back')) {
			console.log("[OTA DOM Background]: GO BACK or GO FORWARD navigation detected in tab:", tabId);
			var summaryEvent = {
				type: "go back or forward",
				actionTimestamp: Date.now(),
				eventTarget: "",
				allEvents: "",
				pageHTMLContent: pageContentStore[tabId]
			};
			sendDataToCollectorServer(summaryEvent);
		}
	  });

	chrome.webNavigation.onCompleted.addListener(function(details) {
		const tabId = details.tabId;
		if(!pageContentStore[tabId]){
			return false;
		}
		if (details.frameId === 0) {
			getTabIdPageSanitizedHTMLRequest(tabId);
		  }
	  });
})();
