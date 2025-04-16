(function () {
    "use strict";
	console.log("Content script loaded");

    var MutationObserver = window.MutationObserver || window.WebKitMutationObserver;
	window.lastClickedTarget = null;
	window.OTAinputFieldValues = {};

	let clickTimer = null;
	let doubleClicked = false;
	const CLICK_DELAY = 500; // delay in ms to distinguish single vs double clic

	// --- NEW: Buffer for mutation records ---
	var mutationBuffer = [];
	var BUFFER_WINDOW = 1000; // milliseconds for before/after user action

    if (typeof MutationObserver !== 'function') {
        console.error('DOM Listener Extension: MutationObserver is not available in your browser.');
        return;
    }

    var observer = new MutationObserver(onMutation);
    var observerSettings = {
        subtree: true,
        childList: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
    };

    var nodeRegistry = [];

    var bgPageConnection = chrome.runtime.connect({
        name: "content-script"
    });

    bgPageConnection.postMessage({
        type: 'connected',
    });

    function highlightNode(node, color) {
        color = color || { r: 51, g: 195, b: 240 };

        if (node && node.nodeName === '#text') {
            highlightNode(node.parentNode, color);
        } else if (node && node.style) {
            var boxShadowOrg = node.style.boxShadow;

            var player = node.animate([
                { boxShadow: '0 0 0 5px rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', 1)' },
                { boxShadow: '0 0 0 5px rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', 0)' }
            ], 600);

            player.onfinish = function () {
                node.style.boxShadow = boxShadowOrg;
            };
        }
    }

    function scrollIntoView(node) {
        if (node && node.nodeName === '#text') {
            scrollIntoView(node.parentNode);
        } else if (node.scrollIntoViewIfNeeded) {
            node.scrollIntoViewIfNeeded();
        }
    }

    function nodeToSelector(node, contextNode) {
        if (node.id) {
            return '#' + node.id;
        } else if (node.classList && node.classList.length) {
            return node.tagName + '.' + Array.prototype.join.call(node.classList, '.');
        } else if (node.parentElement && node.parentElement !== contextNode) {
            var parentSelector = nodeToSelector(node.parentElement, contextNode);

            if (node.nodeName === '#comment') {
                return parentSelector + ' > (comment)';
            } else if (node.nodeName === '#text') {
                return parentSelector + ' > (text)';
            } else {
                return parentSelector + ' > ' + node.nodeName;
            }
        } else if (node.nodeName) {
            if (node.nodeName === '#comment') {
                return '(comment)';
            } else if (node.nodeName === '#text') {
                return '(text)';
            } else {
                return node.nodeName;
            }
        } else {
            return '(unknown)';
        }
    }

	function nodeToHTMLString(node) {
		if (!node) return '';
	  
		switch (node.nodeType) {
		  case Node.ELEMENT_NODE:
			// Return the entire HTML structure, including the node's children
			return trimChangedEventNode(node, 5);//trimElementWithPlaceholder(node, 3);//node.cloneNode(true).outerHTML;
		  case Node.TEXT_NODE:
			return node.nodeValue; // or node.textContent.trim() if you want to trim
		  case Node.COMMENT_NODE:
			return '<!-- ' + node.nodeValue + ' -->';
		  default:
			// For other node types (e.g., document, documentFragment, etc.)
			return '';
		}
	  }
	
    function nodesToObjects(nodes, contextNode) {
        return Array.prototype.map.call(nodes, function (node) {
            return nodeToObject(node, contextNode);
        });
    }

    function nodeToObject(node, contextNode) {
        var nodeId = nodeRegistry.indexOf(node);

        if (nodeId === -1) {
            nodeRegistry.push(node);
            nodeId = nodeRegistry.length - 1;
        }

        return {
            selector: nodeToSelector(node, contextNode),
			nodeInfo: nodeToHTMLString(node),
            nodeId: nodeId
        };
    }

    // --- Updated logEvent remains the same ---
    function logEvent(event) {
        event.date = Date.now();

        bgPageConnection.postMessage({
            type: 'event',
            event: event
        });
    }

    function isAttached(node) {
        if (node === document) {
            return true;
        } else if (node.parentNode) {
            return isAttached(node.parentNode);
        } else if (node.host) {
            return isAttached(node.host);
        }

        return false;
    }

    function cleanUpNodeRegistry() {
        //get rid of detached nodes
        for (var i = 0, l = nodeRegistry.length; i < l; i++) {
            var node = nodeRegistry[i];

            if (node && !isAttached(node)) {
                nodeRegistry[i] = null;
            }
        }
    }

    // --- NEW: onMutation now only buffers the mutation records ---
    function onMutation(records) {
        var now = Date.now();
        for (var i = 0, l = records.length; i < l; i++) {
            var record = records[i];
            record.timestamp = now;
            mutationBuffer.push(record);

            // For added nodes, still observe any new shadow roots
            if (record.type === 'childList' && record.addedNodes.length) {
                Array.prototype.forEach.call(record.addedNodes, function (node) {
                    findShadowRoots(node).forEach(function (shadowRoot) {
                        observer.observe(shadowRoot, observerSettings);
                    });
                });
            }

            // For removed nodes, clean up the registry
            if (record.type === 'childList' && record.removedNodes.length) {
                cleanUpNodeRegistry();
            }
        }
    }

    // --- Helper to transform a mutation record into a loggable event ---
    function transformRecord(record) {
		function isValidSelector(selector) {
			const nonValidSelectors = new Set(['NOSCRIPT', 'SCRIPT']);
			if (!selector) return false;
		
			const upperSelector = selector.toUpperCase();
			const parts = upperSelector.split('>').map(part => part.trim());
		
			for (const part of parts) {
				if (nonValidSelectors.has(part)) {
					return false;
				}
			}
			return !nonValidSelectors.has(selector);
		}
        if (record.type === 'childList') {
            var events = [];
            if (record.addedNodes && record.addedNodes.length) {

				let event = {
                    type: 'nodes added',
                    target: nodeToObject(record.target),
                    nodes: nodesToObjects(record.addedNodes, record.target)
                }
				if(isValidSelector(event.nodes[0].selector)){
					events.push(event);
				}
				Array.prototype.forEach.call(record.addedNodes, function (node) {
					highlightNode(node, {r: 138, g: 219, b: 246});
				});
            }
            if (record.removedNodes && record.removedNodes.length) {

				let event = {
                    type: 'nodes removed',
                    target: nodeToObject(record.target),
                    nodes: nodesToObjects(record.removedNodes, record.target)
                }
				if(isValidSelector(event.nodes[0].selector)){
					events.push(event);
				}
				highlightNode(record.target, {r: 255, g: 198, b: 139});
            }
            // Return a single event if only one exists, else an array.
            return events.length === 1 ? events[0] : events;
        } else if (record.type === 'attributes') {
			if(record.attributeName != "ota-use-interactive-target"){
				highlightNode(record.target, {r: 179, g: 146, b: 248});
			}
			let event = {
                type: 'attribute changed',
                target: nodeToObject(record.target),
                attribute: record.attributeName,
                oldValue: record.oldValue,
                newValue: record.target.getAttribute(record.attributeName)
            };
			if(isValidSelector(event.target.selector)){
				return event;
			}
        } else if (record.type === 'characterData') {
			highlightNode(record.target, {r: 254, g: 239, b: 139});
            return {
                type: 'text changed',
                target: nodeToObject(record.target),
                oldValue: record.oldValue,
                newValue: record.target.data
            };
        }
        return null;
    }

	function sendPageContentUpdatetoBackground(status) {
		if(status == "update"){
			const sanitizedHTML = DOMPurify.sanitize(document.documentElement.outerHTML);
			chrome.runtime.sendMessage({
			  type: 'update-page-content',
			  sanitizedPageHTML: sanitizedHTML
			}, function(response) {
			  console.log("Content script: Page content update request sent", response);
			});
		} else if (status == "delete"){
			chrome.runtime.sendMessage({
				type: 'delete-page-content'
			  }, function(response) {
				console.log("Content script: Page content delete request sent", response);
			  });
		}
	  }


	function filterValidEvents(allEvents) {
		return allEvents.filter(event => {
			if (event.type === "attribute changed") {
				if(event.attribute === "ota-use-interactive-target"){
					return false;
				}
				// If oldValue and newValue are identical, discard this event.
				return event.oldValue !== event.newValue;
			}
			return true;
		});
	}

	function getCurrentHTMLSanitized(){
		// Add a hook to remove inline styles after attributes are sanitized.
		DOMPurify.addHook('afterSanitizeAttributes', function(node) {
			if (node.hasAttribute && node.hasAttribute('style')) {
			node.removeAttribute('style');
			}
		});
		
		var config = {
			ALLOWED_TAGS: [
			'a', 'abbr', 'address', 'article', 'aside', 'audio', 
			'b', 'blockquote', 'br', 'button', 'caption', 'cite', 'code', 'col', 'colgroup', 
			'data', 'datalist', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 
			'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 
			'h5', 'h6', 'header', 'hr', 'i', 'img', 'input', 'ins', 'label', 'legend', 
			'li', 'main', 'menu', 'nav', 'ol', 'option', 'output', 'p', 'pre', 'progress', 
			'q', 's', 'section', 'select', 'small', 'span', 'strong', 'sub', 'summary', 'svg',
			'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'textarea', 'time', 'tr', 'ul', 'video',
			'html', 'title', 'body'
			],
			ALLOWED_ATTR: [
			'abbr', 'accept', 'accept-charset', 'accesskey', 'action', 'align', 'alt', 
			'aria-describedby', 'aria-hidden', 'aria-label', 'aria-labelledby', 'border', 
			'cellpadding', 'cellspacing', 'checked', 'cite', 'class', 'cols', 'colspan', 
			'content', 'data', 'datetime', 'default', 'dir', 'disabled', 'download', 'draggable', 
			'enctype', 'for', 'height', 'hidden', 'high', 'href', 'hreflang', 'id', 'inputmode', 
			'ismap', 'label', 'lang', 'list', 'loop', 'low', 'max', 'maxlength', 'media', 
			'method', 'min', 'multiple', 'muted', 'name', 'novalidate', 'onabort', 'onblur', 
			'onchange', 'onclick', 'oncontextmenu', 'onfocus', 'oninput', 'oninvalid', 
			'onreset', 'onscroll', 'onselect', 'onsubmit', 'outerHTML', 'placeholder', 
			'poster', 'preload', 'readonly', 'rel', 'required', 'reversed', 'rows', 'rowspan', 
			'sandbox', 'scope', 'selected', 'shape', 'size', 'span', 'spellcheck', 'src', 
			'srcdoc', 'start', 'step', 'style', 'tabindex', 'target', 'title', 'translate', 
			'type', 'usemap', 'value', 'width', 'wrap', 'ota-use-interactive-target',
			]
		};

		const visibleHTML = getVisibleHTML(0);
		return DOMPurify.sanitize(visibleHTML, config);
	}

    // --- NEW: User Action Handler ---
    function handleUserAction(event) {

		if (CheckIsClickOnInputOrLabel(event)) {
			return;
		}

		var actionTarget = {
			type: event.type,
			target: nodeToHTMLString(event.target),
			targetId: event.target.id,
			targetClass: event.target.className
		}

		const bestInteractiveElement = findBestInteractiveElement(event.target, 3);
		bestInteractiveElement.setAttribute("ota-use-interactive-target", "1");

		if(bestInteractiveElement.tagName == "A"){
			bestInteractiveElement.removeAttribute("ota-use-interactive-target");
			return;
		}

		actionTarget.target = trimTarget(bestInteractiveElement);
        var actionTime = Date.now();

        // Get mutations that occurred within the BUFFER_WINDOW before the action.
        var beforeMutations = mutationBuffer.filter(function (record) {
            return actionTime - record.timestamp <= BUFFER_WINDOW && actionTime - record.timestamp >= 0;
        });

        // Clear the buffer so we can capture after-mutations freshly.
        mutationBuffer = [];

        // Wait for after-mutations to be recorded.
        setTimeout(function () {
            var afterMutations = mutationBuffer.filter(function (record) {
                return record.timestamp - actionTime <= BUFFER_WINDOW && record.timestamp - actionTime >= 0;
            });

            // Transform the raw mutation records to the loggable event format.
            var beforeEvents = beforeMutations.map(transformRecord).reduce(function(acc, item) {
				// If item is an array, concatenate its elements; otherwise, push it.
				if (Array.isArray(item)) {
				  return acc.concat(item);
				} else if (item !== null && item !== undefined) {
				  acc.push(item);
				  return acc;
				}
				return acc;
			  }, []);
            var afterEvents = afterMutations.map(transformRecord).reduce(function(acc, item) {
				// If item is an array, concatenate its elements; otherwise, push it.
				if (Array.isArray(item)) {
				  return acc.concat(item);
				} else if (item !== null && item !== undefined) {
				  acc.push(item);
				  return acc;
				}
				return acc;
			  }, []);

			var allEvents = beforeEvents.concat(afterEvents);
			allEvents = filterValidEvents(allEvents);

			if(allEvents.length <= 1 && allEvents[0].type == "attribute changed"){
				bestInteractiveElement.removeAttribute("ota-use-interactive-target");
				return;
			}

			var summaryEvent = {
				type: event.type,
				actionTimestamp: actionTime,
				eventTarget: actionTarget,
				allEvents: allEvents,
				pageHTMLContent: getCurrentHTMLSanitized()
			};

			bestInteractiveElement.removeAttribute("ota-use-interactive-target");

			chrome.runtime.sendMessage({
				type: 'send-summary-event',
				summaryEvent: summaryEvent
			  }, function(response) {
				console.log("Response from background:", response);
			  });

            // Log the summary of mutations surrounding the user action.
			if (allEvents.length > 0) {
				allEvents.forEach(function(singleEvent) {
					if(singleEvent.attribute != "ota-use-interactive-target"){
						logEvent(singleEvent);
					}
				});
			  }

            // Clear the buffer after processing.
            mutationBuffer = [];
        }, BUFFER_WINDOW);
    }

	function handleUserClickLink(event) {
		// For example, we want to capture data when a link (<a>) is clicked.
		let target = event.target;		
		// Traverse up the DOM tree to find an anchor if the clicked element isn’t directly an <a>
		target = findFirstLinkElementOrNone(target);

		if (target && target.tagName === 'A') {

			var actionTarget = {
				type: event.type,
				target: nodeToHTMLString(target),
				targetId: target.id,
				targetClass: target.className
			}

			target.setAttribute("ota-use-interactive-target", "1");
			actionTarget.target = trimTarget(target);
			var sanitizedPageHTML = getCurrentHTMLSanitized();

			var summaryEvent = {
				type: event.type,
				actionTimestamp: Date.now(),
				eventTarget: actionTarget,
				allEvents: {},
				pageHTMLContent: sanitizedPageHTML
			};

		  // Send the click data to the background script.
		  chrome.runtime.sendMessage({
			type: 'page-go-to',
			clickData: summaryEvent
		  });
		  return true;
		}
		return false;
	}

	function handleGetPageContent(message, sender, sendResponse) {
	if (message.type === 'get-page-content') {
		var sanitizedPageHTML = getCurrentHTMLSanitized();
		sendResponse({ sanitizedPageHTML: sanitizedPageHTML });
	}
	}

	function CheckIsClickOnInputOrLabel(event){
		if (event.target.matches('input, textarea, [contenteditable="true"], label')) {
			if (event.target.matches('label')) {
			  // If the target is a label, try to get its associated input:
			  let associatedInput = null;
			  // First, check if the label has a "for" attribute.
			  if (event.target.hasAttribute('for')) {
				const forId = event.target.getAttribute('for');
				associatedInput = document.getElementById(forId);
			  }
			  // If not, check if the label contains an input/textarea/contenteditable element.
			  if (!associatedInput) {
				  associatedInput = event.target.querySelector('input, textarea, [contenteditable="true"]');
				}
			  if (associatedInput) {
				// Call handleInputClick with the associated input element.
				handleInputClick({target: associatedInput});
			  } else {
				console.log("Clicked label but no associated input found:", event.target);
			  }
			} else {
			  // For input, textarea, or contenteditable elements, handle them directly.
			  handleInputClick(event);
			}
			return true; // End processing so that no further click handling occurs.
		  }
		  return false;
	}

	function handleInputClick(event) {
		const element = event.target;
		const uid = getUniqueIdentifierForInput(element);
		window.OTAinputFieldValues[uid] = element.value;
		console.log("Input clicked and stored:", uid, element.value);
	}



	// "click" listener which will be delayed.
	function debouncedClickHandler(event) {
		// If a click occurs, clear any existing timer.
		if (clickTimer) {
		clearTimeout(clickTimer);
		clickTimer = null;
		}
		
		// Start the timer for a single click.
		clickTimer = setTimeout(() => {
		// If no double click has happened, process as a single click.
		if (!doubleClicked) {
			handleUserAction(event);
		}
		// Reset the double click flag and timer.
		clickTimer = null;
		doubleClicked = false;
		}, CLICK_DELAY);
	}

	// "dblclick" listener.
	function dblClickHandler(event) {
		// Mark that a double click occurred.
		doubleClicked = true;
		// If a timer is pending for single click, cancel it.
		if (clickTimer) {
		clearTimeout(clickTimer);
		clickTimer = null;
		}
		// Process double click action.
		console.log("double click");
		handleUserAction(event);
	}


	function submitHandler(event){
		// Prevent the default submission if desired:
		// event.preventDefault();
	  
		// The target of the submit event is the form element.
		let target = event.target;
	  
		// Build a summary object for the form similar to what you do for links.
		var actionTarget = {
		  type: event.type,
		  target: nodeToHTMLString(target), // full HTML representation of the form
		  targetId: target.id,
		  targetClass: target.className
		};
	  
		// Optionally, if you have similar functions for trimming and sanitizing,
		// you can call them. For example, if you want to mark the target,
		// then trim it:
		target.setAttribute("ota-use-interactive-target", "1");
		actionTarget.target = trimTarget(target);
	  
		// Get the entire current page HTML, sanitized.
		var sanitizedPageHTML = getCurrentHTMLSanitized();
	  
		// Build the summaryEvent object in the same structure as your link click handler.
		var summaryEvent = {
		  type: event.type,
		  actionTimestamp: Date.now(),
		  eventTarget: actionTarget,
		  allEvents: {},  // Customize if you have additional events or data to attach.
		  pageHTMLContent: sanitizedPageHTML
		};
	  
		// Send the summary event to the background script.
		chrome.runtime.sendMessage({
		  type: 'submit',
		  summaryEvent: summaryEvent
		}, function(response) {
		  console.log("Response from background:", response);
		});
	  
		console.log("Content script: Form submit captured", summaryEvent);
	  
		// Optionally, you can remove the attribute after processing.
		target.removeAttribute("ota-use-interactive-target");
	}


    function findShadowRoots(node, list) {
        list = list || [];

        if (node.shadowRoot) {
            list.push(node.shadowRoot);
        }

        if (node && node.querySelectorAll) {
            Array.prototype.forEach.call(node.querySelectorAll('*'), function (child) {
                if (child.tagName && child.tagName.indexOf('-') > -1 && child.shadowRoot) {
                    findShadowRoots(child, list);
                }
            });
        }

        return list;
    }


	function handleInputBlur(event) {
		const element = event.target;
		const uid = getUniqueIdentifierForInput(element);
		const oldValue = window.OTAinputFieldValues[uid] || "";
		const newValue = element.value;
		
		if (oldValue !== newValue) {
			// Send a message to the background with the updated value
		console.log("Input value changed:", event);

		let target = event.target;

		var actionTarget = {
			type: event.type,
			target: "",
			targetId: target.id,
			targetClass: target.className,
			value: target.attributes.value.value
		}

		actionTarget.target = trimTarget(target);

		var summaryEvent = {
			type: "input-change",
			actionTimestamp: Date.now(),
			eventTarget: actionTarget,
			allEvents: {},
			pageHTMLContent: getCurrentHTMLSanitized()
		};
		  chrome.runtime.sendMessage({
			type: 'input-value-changed',
			summaryEvent: summaryEvent
		  });
		  // Update the global dictionary with the new value
		  window.OTAinputFieldValues[uid] = newValue;
		}
	}
	  
	// When starting to listen, attach the blur event only to text inputs:
	function addTextFieldBlurListeners() {
	const textInputs = document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']");
	textInputs.forEach(input => {
		input.addEventListener('blur', handleInputBlur);
	});
	}
	  
	function removeTextFieldBlurListeners() {
	const textInputs = document.querySelectorAll("input[type='text'], textarea, [contenteditable='true']");
	textInputs.forEach(input => {
		input.removeEventListener('blur', handleInputBlur);
	});
	}

    if (!window.domListenerExtension) {
        window.domListenerExtension = {
            startListening: function () {
                observer.disconnect();

                //observe the main document
                observer.observe(document, observerSettings);

                //observe all shadow roots
                findShadowRoots(document).forEach(function (shadowRoot) {
                    observer.observe(shadowRoot, observerSettings);
                });

				document.addEventListener('click', handleUserClickLink);
				document.addEventListener('click', debouncedClickHandler);
				document.addEventListener('dblclick', dblClickHandler);
				document.addEventListener('submit', submitHandler);
				addTextFieldBlurListeners();
				window.addEventListener('popstate', handleUserAction);
				chrome.runtime.onMessage.addListener(handleGetPageContent);
				sendPageContentUpdatetoBackground("update");
            },
            stopListening: function () {
                observer.disconnect();
				document.removeEventListener('click', handleUserClickLink);
				document.removeEventListener('click', debouncedClickHandler);
				document.removeEventListener('dblclick', dblClickHandler);
				document.removeEventListener('submit', submitHandler);
				removeTextFieldBlurListeners();
				window.removeEventListener('popstate', handleUserAction);
				chrome.runtime.onMessage.removeListener(handleGetPageContent);
				sendPageContentUpdatetoBackground("delete");
            },
            getNode: function (nodeId) {
                return nodeRegistry[nodeId];
            },
            highlightNode: function (nodeId) {
                var node = this.getNode(nodeId);

                scrollIntoView(node);
                highlightNode(node);
            }
        };
    }
})();