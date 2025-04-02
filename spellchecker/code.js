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
function getAllTextNodes(node = figma.root) {
  let textNodes = [];
  
  if (node.type === 'TEXT') {
    textNodes.push(node);
  }
  
  // Recursively check children if they exist
  if ('children' in node) {
    for (const child of node.children) {
      textNodes = textNodes.concat(getAllTextNodes(child));
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
      const textNodes = getAllTextNodes();
      if (textNodes.length === 0) {
        figma.ui.postMessage({ 
          type: 'error', 
          message: 'No text layers found in the document' 
        });
        return;
      }

      // Process each text node
      for (const node of textNodes) {
        const text = node.characters;
        if (text.trim()) {
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
          } catch (error) {
            console.error(`Error processing node ${node.id}:`, error);
          }
        }
      }
      
      figma.ui.postMessage({ type: 'check-complete' });
    } catch (error) {
      console.error('Error getting document text:', error);
      figma.ui.postMessage({ 
        type: 'error', 
        message: 'Error getting document text' 
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
