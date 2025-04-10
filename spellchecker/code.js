figma.showUI(__html__, { width: 400, height: 600 });

// Load fonts before modifying text
async function loadTextNodeFonts(node) {
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  const fontLoadPromises = fonts.map(font => 
    figma.loadFontAsync({ family: font.family, style: font.style })
  );
  await Promise.all(fontLoadPromises);
}

// Get all text nodes in the document recursively
async function getAllTextNodes(node = figma.currentPage) {
  let textNodes = [];
  
  // If it's a page, make sure it's loaded first
  if (node.type === 'PAGE') {
    try {
      await node.loadAsync();
    } catch (error) {
      console.error(`Failed to load page ${node.name}:`, error);
      return textNodes;
    }
  }
  
  if (node.type === 'TEXT') {
    textNodes.push(node);
  }
  
  // Recursively check children if they exist
  if ('children' in node) {
    for (const child of node.children) {
      const childNodes = await getAllTextNodes(child);
      textNodes = textNodes.concat(childNodes);
    }
  }
  
  return textNodes;
}

// Apply text correction to a node
async function applyCorrection(node, fix) {
  try {
    if (!fix || typeof fix.offset !== 'number' || typeof fix.length !== 'number' || !fix.replacement) {
      throw new Error('Invalid fix data');
    }

    const text = node.characters;
    if (fix.offset < 0 || fix.offset + fix.length > text.length) {
      throw new Error('Invalid fix position');
    }

    // Load fonts before modifying text
    await loadTextNodeFonts(node);

    const before = text.substring(0, fix.offset);
    const after = text.substring(fix.offset + fix.length);
    const newText = before + fix.replacement + after;
    
    node.characters = newText;
    return newText;
  } catch (error) {
    console.error('Error applying fix:', error);
    throw error;
  }
}

// Scan all pages in the document
async function scanAllPages() {
  try {
    // Load all pages first
    await figma.loadAllPagesAsync();
    
    let allTextNodes = [];
    
    // Process each page
    for (const page of figma.root.children) {
      if (page.type === 'PAGE') {
        try {
          // Load the page content
          await page.loadAsync();
          
          // Get text nodes from this page
          const pageTextNodes = await getAllTextNodes(page);
          allTextNodes = allTextNodes.concat(pageTextNodes);
        } catch (pageError) {
          console.error(`Error processing page ${page.name}:`, pageError);
          // Continue with other pages
        }
      }
    }
    
    return allTextNodes;
  } catch (error) {
    console.error('Error scanning all pages:', error);
    throw error;
  }
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-text') {
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.ui.postMessage({ 
        type: 'error', 
        message: 'No text layer selected' 
      });
      return;
    }

    const node = selection[0];
    if (node.type !== 'TEXT') {
      figma.ui.postMessage({ 
        type: 'error', 
        message: 'Selected layer is not a text layer' 
      });
      return;
    }

    try {
      const text = node.characters;
      if (!text.trim()) {
        figma.ui.postMessage({ 
          type: 'error', 
          message: 'Selected text layer is empty' 
        });
        return;
      }

      await loadTextNodeFonts(node);

      figma.ui.postMessage({ 
        type: 'text-content',
        text: text,
        nodeInfo: {
          nodeId: node.id,
          nodeName: node.name
        }
      });
    } catch (error) {
      console.error('Error getting text:', error);
      figma.ui.postMessage({ 
        type: 'error', 
        message: 'Error getting text content' 
      });
    }
  } 
  else if (msg.type === 'get-document-text') {
    try {
      // Inform UI that we're starting to scan
      figma.ui.postMessage({ 
        type: 'scan-started'
      });
      
      // Get text nodes from all pages
      const textNodes = await scanAllPages();
      
      if (textNodes.length === 0) {
        figma.ui.postMessage({ 
          type: 'error', 
          message: 'No text layers found in the document' 
        });
        return;
      }

      let processedCount = 0;
      const totalNodes = textNodes.length;
      
      // Process each text node with proper error handling for each node
      for (const node of textNodes) {
        try {
          const text = node.characters;
          if (text && text.trim()) {
            try {
              await loadTextNodeFonts(node);
              figma.ui.postMessage({ 
                type: 'text-content',
                text: text,
                nodeInfo: {
                  nodeId: node.id,
                  nodeName: node.name || 'Unnamed Text Layer'
                }
              });
            } catch (nodeError) {
              console.error(`Error processing node ${node.id}:`, nodeError);
              // Continue processing other nodes
            }
          }
          
          processedCount++;
          // Send progress updates
          if (processedCount % 5 === 0 || processedCount === totalNodes) {
            figma.ui.postMessage({ 
              type: 'progress-update',
              processed: processedCount,
              total: totalNodes
            });
          }
        } catch (nodeError) {
          console.error(`Error with text node ${node.id}:`, nodeError);
          // Continue with other nodes
        }
      }
      
      figma.ui.postMessage({ type: 'check-complete' });
    } catch (error) {
      console.error('Error getting document text:', error);
      figma.ui.postMessage({ 
        type: 'error', 
        message: 'Error getting document text: ' + error.message 
      });
    }
  }
  else if (msg.type === 'apply-fix') {
    const fix = msg.fix;
    
    try {
      if (!fix.nodeId) {
        throw new Error('No node ID provided for fix');
      }

      const node = figma.getNodeById(fix.nodeId);
      if (!node || node.type !== 'TEXT') {
        throw new Error('Text node not found');
      }
      
      const newText = await applyCorrection(node, fix);
      figma.ui.postMessage({ 
        type: 'text-content',
        text: newText,
        nodeInfo: {
          nodeId: node.id,
          nodeName: node.name
        }
      });
    } catch (error) {
      console.error('Error applying fix:', error);
      figma.ui.postMessage({ 
        type: 'error', 
        message: `Error applying fix: ${error.message}` 
      });
    }
  }
};
