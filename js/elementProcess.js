const DOM_CACHE = {
    boundingRects: new WeakMap(),
    computedStyles: new WeakMap(),
    clearCache: () => {
      DOM_CACHE.boundingRects = new WeakMap();
      DOM_CACHE.computedStyles = new WeakMap();
    }
  };

/**
 * Searches up to maxDepth levels upward and downward from a target node
 * for an interactive element. If an interactive element is found, returns it;
 * otherwise returns the original target.
 * 
 * Priority:
 *   - If the target is already interactive, return it.
 *   - Otherwise, for each depth level from 1 to maxDepth, check:
 *       1. Upward: the d-th parent.
 *       2. Downward: all nodes exactly d levels beneath the target (BFS order).
 *           In downward search, the first found interactive element wins.
 *
 * @param {Node} target - The DOM node that was the original event target.
 * @param {number} [maxDepth=3] - Maximum number of levels to search.
 * @returns {Node} The best-matching interactive element, or the original target.
 */
function findBestInteractiveElement(target, maxDepth = 3) {
	// Define the interactive elements as a set (lowercase for ease of comparing tagName)
	const interactiveElements = new Set([
	  "a", "button", "input", "select", "textarea",
	  "details", "summary", "label", "option", "optgroup", "fieldset", "legend"
	]);
  
	// Helper: Determine if an element is interactive.
	function isInteractive(el) {
	  // Ensure we have an element and a tag name
	  if (!el || !el.tagName) return false;
	  return interactiveElements.has(el.tagName.toLowerCase());
	}
  
	// If the original target is already interactive, no need to search.
	if (isInteractive(target)) {
	  return target;
	}
  
	// For each depth level (from 1 to maxDepth)
	for (let d = 1; d <= maxDepth; d++) {
	  // --- Upward search: go d levels up.
	  let current = target;
	  for (let i = 0; i < d; i++) {
		if (current.parentElement) {
		  current = current.parentElement;
		} else {
		  current = null;
		  break;
		}
	  }
	  if (current && isInteractive(current)) {
		// Priority: parent's result wins at each round.
		return current;
	  }
  
	  // --- Downward search: BFS to nodes exactly d levels below.
	  // We'll use an array as a queue; each item is { node, depth }.
	  let queue = [];
	  // Start with all direct children at depth 1.
	  Array.from(target.children).forEach(child => queue.push({ node: child, depth: 1 }));
  
	  while (queue.length > 0) {
		let { node, depth } = queue.shift();
		if (depth === d && isInteractive(node)) {
		  // Return the first interactive element found at the appropriate depth.
		  return node;
		}
		// Only add children if we haven't reached the target depth.
		if (depth < d) {
		  Array.from(node.children).forEach(child => {
			queue.push({ node: child, depth: depth + 1 });
		  });
		}
	  }
	}
  
	// If nothing was found in either direction up to maxDepth, return the original target.
	return target;
  }


  function getCachedBoundingRect(element) {
    if (!element) return null;

    if (DOM_CACHE.boundingRects.has(element)) {

      return DOM_CACHE.boundingRects.get(element);
    }


    let rect;
	rect = element.getBoundingClientRect();

    if (rect) {
      DOM_CACHE.boundingRects.set(element, rect);
    }
    return rect;
  }


/**
 * Checks if an element is within the expanded viewport.
 */
function isInExpandedViewport(element, viewportExpansion) {
	if (viewportExpansion === -1) {
		return true;
	}

	const rect = getCachedBoundingRect(element);

	// Simple viewport check without scroll calculations
	return !(
		rect.bottom < -viewportExpansion ||
		rect.top > window.innerHeight + viewportExpansion ||
		rect.right < -viewportExpansion ||
		rect.left > window.innerWidth + viewportExpansion
	);
	}


  /**
 * Recursively clone a node, but only include nodes that are visible in the viewport.
 * For element nodes, if the node itself is not visible (per isInExpandedViewport),
 * the function returns null. Otherwise, it clones the node (without children) and
 * then appends visible cloned children.
 *
 * @param {Node} node - The node to clone.
 * @param {number} viewportExpansion - Parameter for viewport check.
 * @return {Node|null} The cloned visible node, or null if it should not be included.
 */
function cloneVisible(node, viewportExpansion = 0) {
  // For text nodes, just clone them.
  if (node.nodeType === Node.TEXT_NODE) {
    // Optionally, you can check for whitespace-only text.
    if (!node.textContent.trim()) {
      return null;
    }
    return node.cloneNode(false);
  }

  // For element nodes, check visibility.
  if (node.nodeType === Node.ELEMENT_NODE) {
    // If the element is not visible per our check, skip it.
	const isInVpoint = isInExpandedViewport(node, viewportExpansion)
    if (!isInVpoint) {
      return null;
    }

    // Create a shallow clone (without children)
    let clone = node.cloneNode(false);

    // Recursively process children.
    node.childNodes.forEach(child => {
      const clonedChild = cloneVisible(child, viewportExpansion);
      if (clonedChild) {
        clone.appendChild(clonedChild);
      }
    });

    return clone;
  }

  // For other node types (comments, etc.), you can choose whether to keep them.
  return null;
}

/**
 * Gets the HTML string for the current page but only for visible nodes.
 *
 * @param {number} viewportExpansion - How much extra area to consider as visible.
 * @return {string} The HTML string containing only nodes in the viewport.
 */
function getVisibleHTML(viewportExpansion = 0) {
	DOM_CACHE.clearCache();
  // Clone the document element (or document.body if preferred)
  const clone = document.documentElement.cloneNode(false);
  // Process all children from the original document.documentElement.
  document.documentElement.childNodes.forEach(child => {
	  const clonedChild = cloneVisible(child, viewportExpansion);
	  if (clonedChild) {
      clone.appendChild(clonedChild);
    }
  });
  return clone.outerHTML;
}

  