(function () {
    "use strict";
	console.log("Content script loaded");

    var MutationObserver = window.MutationObserver || window.WebKitMutationObserver;
	window.lastClickedTarget = null;

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

    // --- NEW: Buffer for mutation records ---
    var mutationBuffer = [];
    var BUFFER_WINDOW = 1000; // milliseconds for before/after user action

    function highlightNode(node, color) {
        color = color || { r: 51, g: 195, b: 240 };

        if (node && node.nodeName === '#text') {
            highlightNode(node.parentNode, color);
        } else if (node && node.style) {
            var boxShadowOrg = node.style.boxShadow;

            var player = node.animate([
                { boxShadow: '0 0 0 5px rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', 1)' },
                { boxShadow: '0 0 0 5px rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', 0)' }
            ], 6000);

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
			return node.cloneNode(true).outerHTML;
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
        if (record.type === 'childList') {
            var events = [];
            if (record.addedNodes && record.addedNodes.length) {
                events.push({
                    type: 'nodes added',
                    target: nodeToObject(record.target),
                    nodes: nodesToObjects(record.addedNodes, record.target)
                });
            }
            if (record.removedNodes && record.removedNodes.length) {
                events.push({
                    type: 'nodes removed',
                    target: nodeToObject(record.target),
                    nodes: nodesToObjects(record.removedNodes, record.target)
                });
            }
            // Return a single event if only one exists, else an array.
            return events.length === 1 ? events[0] : events;
        } else if (record.type === 'attributes') {
            return {
                type: 'attribute changed',
                target: nodeToObject(record.target),
                attribute: record.attributeName,
                oldValue: record.oldValue,
                newValue: record.target.getAttribute(record.attributeName)
            };
        } else if (record.type === 'characterData') {
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

	function isInteractive(element) {
		if (!element) return false;
		var interactiveTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
		if (interactiveTags.indexOf(element.tagName) !== -1) {
			return true;
		}
		// Check if the element is contentEditable.
		if (element.isContentEditable) {
			return true;
		}
		// Check if an onclick handler is defined or if it has a role of button.
		if (typeof element.onclick === 'function' || element.getAttribute('role') === 'button') {
			return true;
		}
		// Optionally, if the element has a tabindex attribute, consider it interactive.
		if (element.hasAttribute('tabindex')) {
			return true;
		}
		return false;
	}


	/**
	 * Recursively builds a trimmed HTML string from the given node.
	 * Only goes N layers deep. Deeper nested content is replaced with a placeholder.
	 *
	 * @param {Node} node - The DOM node to trim.
	 * @param {number} maxDepth - Maximum depth to include.
	 * @param {number} currentDepth - Current recursion level (default 0).
	 * @return {string} The HTML string representing the trimmed node.
	 */
	function trimElementWithPlaceholder(node, maxDepth = 5, currentDepth = 0) {

		if (node.nodeType === Node.TEXT_NODE) {
			return node.textContent;
		  }
		
		  // Skip non-element nodes (you might extend this if needed).
		  if (node.nodeType !== Node.ELEMENT_NODE) {
			return '';
		  }
		
		// Build the opening tag with all its attributes intact.
		let tagName = node.tagName;
		let attrString = '';
		// Iterate through all attributes
		for (let i = 0; i < node.attributes.length; i++) {
			const attr = node.attributes[i];
			attrString += ` ${attr.name}="${attr.value}"`;
		}
	
		let openingTag = `<${tagName}${attrString}>`;
		let closingTag = `</${tagName}>`;
	
		// If we've reached or exceeded the max depth, insert the marker
		if (currentDepth >= maxDepth - 1) {
		return `${openingTag}&rme${closingTag}`;
		}
	
		// Otherwise, process the child nodes recursively.
		let childrenHTML = '';
		node.childNodes.forEach(child => {
		childrenHTML += trimElementWithPlaceholder(child, maxDepth, currentDepth + 1);
		});
	
		return `${openingTag}${childrenHTML}${closingTag}`;
	}


	function trimTarget(node){
		let trimmedHtml = trimElementWithPlaceholder(node, 4);

		if (trimmedHtml.length < 200) {
			return trimmedHtml;
		}

		var purifyConfig = {
			ALLOWED_TAGS: [
			  'a', 'abbr', 'address', 'article', 'aside',
			  'b', 'blockquote', 'br', 'button', 'caption',
			  'cite', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			  'hr', 'i', 'img', 'input', 'label', 'li', 'ol', 'p', 'q',
			  'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
			  'tfoot', 'th', 'thead', 'tr', 'ul', 'select', 'option', 'textarea',
			  'svg', 'path'
			],
			ALLOWED_ATTR: [
			  'id', 'class', 'href', 'src', 'alt', 'ota-use-interactive-target',
			  'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
			  'placeholder', 'type', 'value', 'name', 'checked', 'selected'
			]
		};
		return DOMPurify.sanitize(trimmedHtml, purifyConfig);
	}

	function filterValidEvents(allEvents) {
		return allEvents.filter(event => {
			if (event.type === "attribute changed") {
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

		var actionTarget = {
			type: event.type,
			target: nodeToHTMLString(event.target),
			targetId: event.target.id,
			targetClass: event.target.className
		}

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
            var beforeEvents = beforeMutations.map(transformRecord).filter(function (e) { return e !== null; });
            var afterEvents = afterMutations.map(transformRecord).filter(function (e) { return e !== null; });

			var allEvents = beforeEvents.concat(afterEvents);
			allEvents = filterValidEvents(allEvents);

			if(allEvents.length == 0){
				return;
			}

			const bestInteractiveElement = findBestInteractiveElement(event.target, 3);
			bestInteractiveElement.setAttribute("ota-use-interactive-target", "1");
			actionTarget.target = trimTarget(bestInteractiveElement);
			var sanitizedPageHTML = getCurrentHTMLSanitized();


			var summaryEvent = {
				type: event.type,
				actionTimestamp: actionTime,
				eventTarget: actionTarget,
				allEvents: allEvents,
				pageHTMLContent: sanitizedPageHTML
			};

			bestInteractiveElement.removeAttribute("ota-use-interactive-target");

			// sendSummaryEvent(summaryEvent);
			chrome.runtime.sendMessage({
				type: 'send-summary-event',
				summaryEvent: summaryEvent
			  }, function(response) {
				console.log("Response from background:", response);
			  });

            // Log the summary of mutations surrounding the user action.
			if (allEvents.length > 0) {
				allEvents.forEach(function(singleEvent) {
				  logEvent(singleEvent);
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
		while (target && target.tagName !== 'A' && target.parentElement) {
		  target = target.parentElement;
		}
	  
		if (target && target.tagName === 'A') {

			var actionTarget = {
				type: event.type,
				target: nodeToHTMLString(event.target),
				targetId: event.target.id,
				targetClass: event.target.className
			}

			event.target.setAttribute("ota-use-interactive-target", "1");
			actionTarget.target = trimTarget(event.target);
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

		  console.log("Content script: User click captured", clickData);
		}
	}

	function handleGetPageContent(message, sender, sendResponse) {
	if (message.type === 'get-page-content') {
		var sanitizedPageHTML = getCurrentHTMLSanitized();
		sendResponse({ sanitizedPageHTML: sanitizedPageHTML });
	}
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

	// --- Attach user action event listeners ---
	// document.addEventListener('click',handleUserClickLink);
	// document.addEventListener('click', handleUserAction);
	// document.addEventListener('keydown', handleUserAction);
	// window.addEventListener('popstate', handleUserAction);
	// chrome.runtime.onMessage.addListener(handleGetPageContent);

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

				document.addEventListener('click',handleUserClickLink);
				document.addEventListener('click', handleUserAction);
				document.addEventListener('keydown', handleUserAction);
				window.addEventListener('popstate', handleUserAction);
				chrome.runtime.onMessage.addListener(handleGetPageContent);
				sendPageContentUpdatetoBackground("update");
            },
            stopListening: function () {
                observer.disconnect();
				document.removeEventListener('click', handleUserClickLink);
				document.removeEventListener('click', handleUserAction);
				document.removeEventListener('keydown', handleUserAction);
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