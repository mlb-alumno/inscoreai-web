


document.addEventListener("DOMContentLoaded", () => {
    let tk = null;
    let originalMEI = null; // Always stores MEI format
    let selectedMeasureIds = [];
    let selectedMeasureNumbers = []; // To store measure number
    let lastSelectedMeasure = null;
    let isShiftPressed = false;
    let playbackMode = 'full'; // 'full' or 'selection'
    let isMXL = false;
    let selectedStartTime = null;
    let selectedEndTime = null;
    let top_p = 0.95;
    let historyStack = [];
    let redoStack = [];
    let isEditMode = false;
    let selectedStaffId = null;
    let currentDuration = '4';
    let currentDots = 0; // Track dots for the current duration
    let midiInput = null;
    let staffCleared = false;
    let isRestInput = false;
    let currentPage = 1;
    let notationElement = document.getElementById("notation");
    let playbackOffset = 0;
    const activeSynths = [];
    let pianoSampler = null;
    let samplesLoaded = false;
    let currentPart = null;
    let currentProposals = [];
    let currentProposalIndex = 0;
    let generationState = {
        active: false,
        currentStep: 0,
        totalSteps: 2,
        overlayElement: null,
        selectedMeasuresRect: null,
        highlightVisible: false
    };
    const ORIGINAL_INDEX = -1;
    
    let peer = null;
    let conn = null;
    let connectionStatusElement = document.getElementById('connectionStatus');
    let statusLight = document.getElementById('statusLight');
    let statusText = document.getElementById('statusText');
    let pressedNotes = new Set(); // Track currently pressed MIDI notes


    updateConnectionStatus(false);
    

    peer = new Peer({
        config: { 
          iceServers: [
            { url: 'stun:stun.l.google.com:19302' },
            { url: 'turn:global.relay.metered.ca:80', username: 'your_username', credential: 'your_credential' }
          ]
        }
      });

      conn = null;
      // Handle incoming connections
    peer.on('connection', (connection) => {
        conn = connection;
        setupDataConnection();
    });
    
    peer.on('disconnected', () => {
        updateConnectionStatus(false);
    });


    // Connect button handler
    document.getElementById('connectPeer').addEventListener('click', () => {
        const peerId = document.getElementById('peerIdInput').value;
        connectToPeer(peerId);
    });

    // Peer connection functions
    function connectToPeer(peerId) {
        if (conn) {
          conn.close(); // Close existing connection
        }
        conn = peer.connect(peerId);
        setupDataConnection();
      }
      
      peer.on('open', (id) => {
        document.getElementById('peerIdDisplay').textContent = `Your ID: ${id}`;
      });
    
      function setupDataConnection() {
        conn.on('open', () => {
            console.log('Connected!');
            updateConnectionStatus(true, conn.peer); // Show peer ID
            conn.send({ 
                type: 'fullState', 
                mei: originalMEI, 
                history: historyStack,
                currentProposals: currentProposals,
                currentProposalIndex: currentProposalIndex
            });
        });
    
        conn.on('data', (data) => {
            if (data.type === 'fullState') {
                // Only update if we're the receiving peer (empty state)
                if (!originalMEI || historyStack.length === 0) {
                  originalMEI = data.mei;
                  historyStack = data.history;
                  currentProposals = data.currentProposals || [];
                  currentProposalIndex = data.currentProposalIndex || 0;
                  renderScore(originalMEI);
                }
                updateButtonStates();
            } else if (data.type === 'meiUpdate') {
                originalMEI = data.mei;
                historyStack = data.history;
                renderScore(originalMEI);
                updateButtonStates();
            } else if (data.type === 'aiProposals') {
                currentProposals = data.proposals;
                currentProposalIndex = 0;
                generationState.selectedMeasureNumbersAtStart = data.measureNumbers;
                generationState.originalMEIBackup = data.originalMEI;
                showProposalSelector();
                updateProposalDisplay();
            } else if (data.type === 'showOverlay') {
                generationState.selectedMeasureNumbersAtStart = data.measureNumbers || [];
                showGenerationOverlay(data.text);
                setGeneratingHighlight(true);
            } else if (data.type === 'clearOverlay') {
                hideGenerationOverlay();
                setGeneratingHighlight(false);
            } else if (data.type === 'proposalDecision') {
                // Update the MEI to the one sent
                originalMEI = data.mei;
                
                // Reset proposal state
                currentProposals = [];
                currentProposalIndex = ORIGINAL_INDEX;
                
                // Update UI
                setGeneratingHighlight(false);
                renderScore(originalMEI);
                hideProposalSelector();
              
                
                // Update history stack
                if (data.accepted) {
                    historyStack.push(originalMEI);
                    if (historyStack.length > MAX_HISTORY) historyStack.shift();
                    redoStack = [];
                }
                updateButtonStates();
            } else if (data.type === 'clearSelector') {
                hideProposalSelector();
            }
        });

        conn.on('close', () => {
            updateConnectionStatus(false);
            conn = null; // Clear connection reference
          })
    }

    function broadcastUpdate() {
        if (conn && conn.open) {
            conn.send({ 
                type: 'meiUpdate',
                mei: originalMEI,
                history: historyStack.slice(-MAX_HISTORY) 
            });
        }
    }

    function broadcastProposals() {
        if (conn && conn.open) {
            conn.send({
                type: 'aiProposals',
                proposals: currentProposals,
                measureNumbers: generationState.selectedMeasureNumbersAtStart,
                originalMEI: generationState.originalMEIBackup
            });
        }
    }

    function showAndBroadcastOverlay(text) {
        showGenerationOverlay(text);

        if (conn && conn.open) {
            conn.send({
                type: 'showOverlay',
                text: text,
                measureNumbers: generationState.selectedMeasureNumbersAtStart
            });
        }
    }



    function broadcastProposalDecision(accepted, mei) {
        if (conn && conn.open) {
            conn.send({
                type: 'proposalDecision',
                accepted: accepted,
                mei: mei,
                originalMEIBackup: generationState.originalMEIBackup
            });
        }
    }
    



    const MAX_HISTORY = 10;
    if (historyStack.length > MAX_HISTORY) historyStack.shift();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') isShiftPressed = true;
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') isShiftPressed = false;
    });

    

    verovio.module.onRuntimeInitialized = async () => {

        updateButtonStates(); 

        tk = new verovio.toolkit();
        console.log("Verovio initialized");
        
        tk.setOptions({
            scale: 65,
            scaleToPageSize: false,
            systemDivider: 'none',            
            footer: "none",   // Remove footer symbols
        });

        connectionStatusElement = document.getElementById('connectionStatus');
        statusLight = document.getElementById('statusLight');
        statusText = document.getElementById('statusText');

        document.getElementById('sidebarClose').addEventListener('click', function() {
            document.querySelector('aside').classList.add('sidebar-hidden');
        });

        // Load default score
        document.getElementById("loadDefault").addEventListener("click", loadLocalMusicXML);
        
        // Setup MXL file input
        document.getElementById("mxlFile").addEventListener("change", handleFileUpload);
        
        // Download handlers
        // document.getElementById("downloadMeasureMidi").addEventListener("click", downloadMeasureMidi);
        document.getElementById("downloadFullScore").addEventListener("click", downloadFullScore);

        // Toggle edit mode
        document.getElementById("enterNotes").addEventListener("click", toggleEditMode);

        // Initial load
        loadLocalMusicXML();


        document.getElementById("sendData").addEventListener("click", sendDataToBackendHarmony);
        document.getElementById("sendDataInfill").addEventListener("click", sendDataToBackendInfill);
        document.getElementById("sendDataMelody").addEventListener("click", sendDataToBackendMelody);
        document.getElementById("playMIDI").addEventListener("click", playMIDIHandler);
        document.getElementById("stopMIDI").addEventListener("click", stopTonePlayback);
        document.getElementById("playSelection").addEventListener("click", playSelectionHandler);
        document.getElementById("undoButton").addEventListener("click", undoHandler);
        document.getElementById("redoButton").addEventListener("click", redoHandler);

        document.getElementById("top_p").addEventListener("input", (e) => {
            top_p = parseFloat(e.target.value);
            document.getElementById("top_p_value").textContent = e.target.value;
        });

        document.getElementById("addMeasures").addEventListener("click", addEmptyMeasures);
        document.getElementById("appendScore").addEventListener("click", () => {
            document.getElementById("appendFile").click();
        });
        document.getElementById("appendFile").addEventListener("change", handleAppendFile);

        document.getElementById("nextPage").addEventListener("click", nextPageHandler);
        document.getElementById("prevPage").addEventListener("click", prevPageHandler);
        document.getElementById('prev-proposal').addEventListener('click', () => {
            if (currentProposalIndex === 0) {
                currentProposalIndex = ORIGINAL_INDEX;
            } else if (currentProposalIndex === ORIGINAL_INDEX) {
                currentProposalIndex = currentProposals.length - 1;
            } else {
                currentProposalIndex--;
            }
            updateProposalDisplay(); 
        });
        
        document.getElementById('next-proposal').addEventListener('click', () => {
            if (currentProposalIndex === currentProposals.length - 1) {
                currentProposalIndex = ORIGINAL_INDEX;
            } else if (currentProposalIndex === ORIGINAL_INDEX) {
                currentProposalIndex = 0;
            } else {
                currentProposalIndex++;
            }
            updateProposalDisplay();  
        });

        document.getElementById('proposal-accept').addEventListener('click', () => {
            // Save current state to history
            historyStack.push(originalMEI);
            if (historyStack.length > MAX_HISTORY) historyStack.shift();
            redoStack = [];
            updateButtonStates();
            
            // Create updated MEI with accepted proposal
            let updatedMEI = originalMEI;
            const proposalMEI = currentProposals[currentProposalIndex];
            
            generationState.selectedMeasureNumbersAtStart.forEach(measureNumber => {
                updatedMEI = replaceMeasureInMEI(
                    updatedMEI,
                    proposalMEI,
                    measureNumber.toString()
                );
            });

            
        
            // Update application state
            originalMEI = updatedMEI;
            currentProposals = [];
            currentProposalIndex = ORIGINAL_INDEX;
            currentDisplayMEI = originalMEI;
            
            // Update UI
            setGeneratingHighlight(false);
            renderScore(originalMEI);
            hideProposalSelector();
            
            // Broadcast to peers
            broadcastUpdate();
            broadcastProposalDecision(true, updatedMEI);
            
        });
        
        document.getElementById('proposal-reject').addEventListener('click', () => {
            // Revert to original state
            let reverted = originalMEI;
            generationState.selectedMeasureNumbersAtStart.forEach(n => {
                       reverted = replaceMeasureInMEI(
                       reverted,
                       generationState.originalMEIBackup, 
                       n.toString()
                    );
                });
                originalMEI = reverted;    
            currentProposals = [];
            currentProposalIndex = ORIGINAL_INDEX;
            currentDisplayMEI = originalMEI;
            
            setGeneratingHighlight(false);
            // Update UI
            renderScore(originalMEI);
            hideProposalSelector();
            
            // Broadcast to peers
            broadcastUpdate();
            broadcastProposalDecision(false, originalMEI);
            
        });


    };

    function undoHandler() {
        if (historyStack.length > 0) {
            redoStack.push(originalMEI);
            originalMEI = historyStack.pop();
            renderScore(originalMEI);
            updateButtonStates();
            broadcastUpdate();
        }
    }
    
    function redoHandler() {
        if (redoStack.length > 0) {
            historyStack.push(originalMEI);
            originalMEI = redoStack.pop();
            renderScore(originalMEI);
            updateButtonStates(); 
            broadcastUpdate();
        }
    }

    function updateButtonStates() {
        document.getElementById("undoButton").disabled = historyStack.length === 0;
        document.getElementById("redoButton").disabled = redoStack.length === 0;
    }

    async function loadLocalMusicXML() {
        try {
            // Path to the default MusicXML file
            const response = await fetch("example_files/PuerNatusinBet.musicxml"); 
            const musicXML = await response.text();
            historyStack = []; // Reset history when loading new score

            updateButtonStates();
            // Load and convert to MEI
            tk.loadData(musicXML);
            originalMEI = tk.getMEI();
            isMXL = true;
            renderScore(originalMEI);
            
            
        } catch (error) {
            console.error("Error loading MusicXML:", error);
            alert("Failed to load MusicXML file. Make sure:\n1. You're running a local server\n2. The file path is correct");
        }
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                if (file.name.endsWith('.mxl')) {
                    // Handle compressed MusicXML
                    const arrayBuffer = e.target.result;
                    tk.loadZipDataBuffer(arrayBuffer);
                } else if (file.name.endsWith('.musicxml') || file.name.endsWith('.xml')) {
                    // Handle uncompressed MusicXML
                    const musicXML = e.target.result;
                    tk.loadData(musicXML);
                }
                
                // Convert to MEI and store
                originalMEI = tk.getMEI();
                isMXL = true;
                renderScore(originalMEI);
                broadcastUpdate();
                
            } catch (error) {
                console.error("Error loading file:", error);
                alert("Invalid file format. Supported: .mei, .musicxml, .xml, .mxl");
            }
        };

        // Read appropriate format
        if (file.name.endsWith('.mxl')) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }}

    
    function renderScore(meiData) {
        // Save current page before rendering
        const prevPage = currentPage;
        
        // Load the MEI data
        tk.loadData(meiData);
        
        // Get new page count
        const pageCount = tk.getPageCount();
        
        // Adjust current page if needed
        currentPage = Math.min(prevPage, pageCount);
        currentPage = Math.max(1, currentPage);
        
        // Render using the preserved page
        document.getElementById("notation").innerHTML = tk.renderToSVG(currentPage);
        
        // Re-setup interactions
        if (isEditMode) setupStaffSelection();
        setupMeasureInteraction();
        if (generationState.highlightVisible) {
                   requestAnimationFrame(() => setGeneratingHighlight(true));
               }
    }
    function filterMEIByMeasures(meiXML, measureIds) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(meiXML, "text/xml");
        
        xmlDoc.querySelectorAll('measure').forEach(measure => {
            if (!measureIds.includes(measure.getAttribute('xml:id'))) {
                measure.parentNode.removeChild(measure);
            }
        });
    
        return new XMLSerializer().serializeToString(xmlDoc);
    }

    function downloadMeasureMidi() {
        if (selectedMeasureIds.length === 0) {
            alert("Please select at least one measure first!");
            return;
        }
    
        const filteredMEI = filterMEIByMeasures(originalMEI, selectedMeasureIds);
        
        // Create temporary toolkit instance
        const tempTk = new verovio.toolkit();
        tempTk.loadData(filteredMEI);
        
        // Get measure numbers for filename
        const measureNumbers = selectedMeasureIds.map(id => {
            return tk.getElementAttr(id).n;
        }).join("-");
        
        const midiBase64 = tempTk.renderToMIDI();
        const blob = base64ToBlob(midiBase64, "audio/midi");
        saveAs(blob, `measures-${measureNumbers}.mid`);
    }

    function downloadFullScore() {
        // Use the original loaded data (works for both MEI and MXL)
        const midiBase64 = tk.renderToMIDI();
        const blob = base64ToBlob(midiBase64, "audio/midi");
        saveAs(blob, "full-score.mid");
    }

    function base64ToBlob(base64, type) {
        const binary = atob(base64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return new Blob([array], { type });
    }
    function setupMeasureInteraction() {
        const measures = Array.from(document.querySelectorAll("#notation g.measure"));
        const measuresWithData = measures.map(measure => ({
            element: measure,
            id: measure.id,
            n: parseInt(tk.getElementAttr(measure.id).n)
        })).sort((a, b) => a.n - b.n);
    
        measures.forEach(measure => {
            measure.style.cursor = "pointer";
            measure.onclick = (e) => {
                const currentMeasure = measuresWithData.find(m => m.id === measure.id);
                
                // Clear previous highlights unless Shift is pressed
                if (!isShiftPressed) {
                    measures.forEach(m => m.classList.remove('highlighted'));
                    selectedMeasureIds = [];
                    selectedMeasureNumbers = [];
                }
    
                if (isShiftPressed && lastSelectedMeasure) {
                    // Find range of measures
                    const startIndex = Math.min(
                        measuresWithData.findIndex(m => m.n === lastSelectedMeasure.n),
                        measuresWithData.findIndex(m => m.n === currentMeasure.n)
                    );
                    const endIndex = Math.max(
                        measuresWithData.findIndex(m => m.n === lastSelectedMeasure.n),
                        measuresWithData.findIndex(m => m.n === currentMeasure.n)
                    );
    
                    // Select all measures in range
                    selectedMeasureIds = measuresWithData
                        .slice(startIndex, endIndex + 1)
                        .map(m => m.id);
                    selectedMeasureNumbers = measuresWithData
                        .slice(startIndex, endIndex + 1)
                        .map(m => m.n);
                } else {
                    // Single selection
                    selectedMeasureIds.push(measure.id);
                    selectedMeasureNumbers.push(currentMeasure.n);
                    lastSelectedMeasure = currentMeasure;
                }
    
                // Update highlights
                measuresWithData.forEach(m => {
                    if (selectedMeasureIds.includes(m.id)) {
                        m.element.classList.add('highlighted');
                    } else {
                        m.element.classList.remove('highlighted');
                    }
                });
    
                // Update timing data
                updateSelectionTimes();
          
            };
        });
    }

    

    function updateSelectionTimes() {
        if (selectedMeasureIds.length === 0) {
            selectedStartTime = null;
            selectedEndTime = null;
            return;
        }
    
        const times = selectedMeasureIds.map(id => ({
            start: tk.getTimeForElement(id),
            end: getMeasureEndTime(id)
        }));
    
        selectedStartTime = Math.min(...times.map(t => t.start));
        selectedEndTime = Math.max(...times.map(t => t.end));
    }

    

    function replaceMeasureInMEI(originalMEI, newMEI, measureNumber) {
        const parser = new DOMParser();
        const originalDoc = parser.parseFromString(originalMEI, "text/xml");
        const newDoc = parser.parseFromString(newMEI, "text/xml");

        // Find the measure in originalDoc by measure number
        const originalMeasures = originalDoc.getElementsByTagName('measure');
        let originalMeasure;
        for (let m of originalMeasures) {
            if (m.getAttribute('n') === measureNumber) {
                originalMeasure = m;
                break;
            }
        }

        // Find the measure in newDoc by measure number
        const newMeasures = newDoc.getElementsByTagName('measure');
        let newMeasure;
        for (let m of newMeasures) {
            if (m.getAttribute('n') === measureNumber) {
                newMeasure = m;
                break;
            }
        }

        if (!originalMeasure || !newMeasure) {
            console.error('Measure not found');
            return originalMEI;
        }

        // Replace the original measure's content with the new one
        const importedMeasure = originalDoc.importNode(newMeasure.cloneNode(true), true);
        originalMeasure.parentNode.replaceChild(importedMeasure, originalMeasure);

        // Serialize back to MEI string
        const serializer = new XMLSerializer();
        return serializer.serializeToString(originalDoc);
    }


    
    function getMeasureEndTime(measureId) {
        // Get all measures in document order using Verovio's measure numbering
        const allMeasures = Array.from(document.querySelectorAll("#notation g.measure"))
            .sort((a, b) => {
                // Get measure numbers from MEI data attributes
                const aNum = parseInt(tk.getElementAttr(a.id).n);
                const bNum = parseInt(tk.getElementAttr(b.id).n);
                return aNum - bNum;
            });
    
        const currentIndex = allMeasures.findIndex(m => m.id === measureId);
        
        // If there's a next measure, use its start time
        if (currentIndex < allMeasures.length - 1) {
            const nextMeasureId = allMeasures[currentIndex + 1].id;
            return tk.getTimeForElement(nextMeasureId);
        }
        
        // If last measure, get total duration from timemap
        const timemap = JSON.parse(tk.renderToTimemap());
        const lastEvent = timemap[timemap.length - 1];
        return lastEvent.tstamp + lastEvent.duration;
    }

    const playMIDIHandler = async function () {
        if (!tk) return;
    
        let midiBase64;
        playbackOffset = 0;
        const tkForPlayback = new verovio.toolkit();
        
        if (currentProposals.length === 0) {
            currentDisplayMEI = originalMEI;
        }

        if (currentProposalIndex !== ORIGINAL_INDEX && currentDisplayMEI) {
            tkForPlayback.loadData(currentDisplayMEI);
        } else {
            tkForPlayback.loadData(originalMEI);
        }
        if (currentProposals.length === 0) {
        currentDisplayMEI = originalMEI;
    }
    
        if (selectedMeasureIds.length) {
            const filteredMEI = filterMEIFromSelection(tkForPlayback.getMEI(), selectedMeasureIds);
            tkForPlayback.loadData(filteredMEI);
            midiBase64 = tkForPlayback.renderToMIDI();
            playbackOffset = selectedStartTime;
        } else {
            midiBase64 = tkForPlayback.renderToMIDI();
        }
    
        playbackMode = 'full';
        await playWithTone(midiBase64, playbackOffset);
    };
    
    const playSelectionHandler = async function () {
        if (!tk || !selectedMeasureIds.length) return;
    
        const tkForPlayback = new verovio.toolkit();

        if (currentProposalIndex !== ORIGINAL_INDEX && currentDisplayMEI) {
            tkForPlayback.loadData(currentDisplayMEI);
        } else {
            tkForPlayback.loadData(originalMEI);
        }
    
        const filteredMEI = filterMEIByMeasures(tkForPlayback.getMEI(), selectedMeasureIds);
        tkForPlayback.loadData(filteredMEI);
    
        playbackMode = 'selection';
        playbackOffset = selectedStartTime;
        await playWithTone(tkForPlayback.renderToMIDI(), selectedStartTime);
    };
    
    const stopMIDIHandler = stopTonePlayback;
    
    const midiHightlightingHandler = function (event) {
        // Remove previous highlights
        document.querySelectorAll('.playing').forEach(note => {
            note.classList.remove('playing');
        });
    
        if (!tk) return;
    
        const currentTime = event.time * 1000 + playbackOffset; 
        const currentElements = tk.getElementsAtTime(currentTime);
    
    
        if (currentElements.page !== currentPage) {
            currentPage = currentElements.page;
            document.getElementById("notation").innerHTML = tk.renderToSVG(currentPage);
            setupMeasureInteraction();
        }
    
        currentElements.notes.forEach(noteId => {
            const noteElement = document.getElementById(noteId);
            if (noteElement) noteElement.classList.add('playing');
        });
    };

    


    function filterMEIFromSelection(meiXML, measureIds) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(meiXML, "text/xml");
        
        // Get all measures and find first selected measure number
        const allMeasures = Array.from(xmlDoc.getElementsByTagName('measure'));
        const selectedMeasures = allMeasures.filter(m => measureIds.includes(m.getAttribute('xml:id')));
        const firstSelectedN = Math.min(...selectedMeasures.map(m => parseInt(m.getAttribute('n'))));
    
        // Remove all measures before the first selected one
        allMeasures.forEach(measure => {
            const measureN = parseInt(measure.getAttribute('n'));
            if (measureN < firstSelectedN) {
                measure.parentNode.removeChild(measure);
            }
        });
    
        return new XMLSerializer().serializeToString(xmlDoc);
    }

    async function sendDataToBackendHarmony() {
        if (selectedMeasureIds.length === 0) {
            alert("Please select at least one measure first!");
            return;
        }
        
        if (generationState.active) return;
    
        generationState.active = true;
        currentProposals = [];
        currentProposalIndex = ORIGINAL_INDEX;
    
        // Store initial state and selection
        generationState.originalMEIBackup = originalMEI;
        generationState.selectedMeasureIdsAtStart = [...selectedMeasureIds];
        generationState.selectedMeasureNumbersAtStart = [...selectedMeasureNumbers];
        
        try {
            // First proposal
            setGeneratingHighlight(true);
            showAndBroadcastOverlay("Generating proposal 1/2...");
            const firstProposal = await processHarmonyRequest();
            currentProposals.push(firstProposal);
            currentProposalIndex = 0;

            showProposalSelector();
            updateProposalDisplay();
            broadcastProposals();
            
            // Second proposal
            showAndBroadcastOverlay("Generating proposal 2/2...");
            const secondProposal = await processHarmonyRequest();
            currentProposals.push(secondProposal);
    
            
            updateProposalDisplay(); 
            broadcastProposals(); 
            
        } catch (error) {
            console.error("Error generating proposals:", error);
            hideGenerationOverlay();
        } finally {
            
            generationState.active = false;
        }
    }

    async function processHarmonyRequest() {
        const midiBase64 = tk.renderToMIDI();
        const midiBlob = base64ToBlob(midiBase64, "audio/midi");
        const formData = new FormData();
        formData.append("midi_file", midiBlob, "full-score.mid");
        formData.append("start_time", selectedStartTime.toString());
        formData.append("end_time", selectedEndTime.toString());
        formData.append("top_p", top_p.toString());
    
        const response = await fetch("https://manuel-l01-inscoreapi.hf.space/upload", {
            method: "POST",
            body: formData,
        });
        const result = await response.json();
    
        if (result.status !== "success") throw new Error(result.message);
    
        const tempTk = new verovio.toolkit();
        tempTk.loadData(result.musicxml);
        return tempTk.getMEI();
    }

    async function sendDataToBackendInfill() {
        if (selectedMeasureIds.length === 0) {
            alert("Please select at least one measure first!");
            return;
        }
        
        if (generationState.active) return;
    
        generationState.active = true;
        currentProposals = [];
        currentProposalIndex = ORIGINAL_INDEX;
    
        // Store initial state and selection
        generationState.originalMEIBackup = originalMEI;
        generationState.selectedMeasureIdsAtStart = [...selectedMeasureIds];
        generationState.selectedMeasureNumbersAtStart = [...selectedMeasureNumbers];
        
        try {
            // First proposal
            setGeneratingHighlight(true);
            showAndBroadcastOverlay("Generating proposal 1/2...");
            const firstProposal = await processInfillRequest();
            currentProposals.push(firstProposal);
            currentProposalIndex = 0;

            hideGenerationOverlay();
            showProposalSelector();
            updateProposalDisplay();
            broadcastProposals();
            
            // Second proposal
            showAndBroadcastOverlay("Generating proposal 2/2...");
            const secondProposal = await processInfillRequest();
            currentProposals.push(secondProposal);
    
            hideGenerationOverlay();
            showProposalSelector();
            updateProposalDisplay(); 
            broadcastProposals(); 
            
        } catch (error) {
            console.error("Error generating proposals:", error);
            hideGenerationOverlay();
        } finally {
            generationState.active = false;
        }
    }

    async function processInfillRequest() {
        const midiBase64 = tk.renderToMIDI();
        const midiBlob = base64ToBlob(midiBase64, "audio/midi");
        const formData = new FormData();
        formData.append("midi_file", midiBlob, "full-score.mid");
        formData.append("start_time", selectedStartTime.toString());
        formData.append("end_time", selectedEndTime.toString());
        formData.append("top_p", top_p.toString());
    
        const response = await fetch("https://manuel-l01-inscoreapi.hf.space/uploadinfill", {
            method: "POST",
            body: formData,
        });
        const result = await response.json();
    
        if (result.status !== "success") throw new Error(result.message);
    
        const tempTk = new verovio.toolkit();
        tempTk.loadData(result.musicxml);
        return tempTk.getMEI();
    }

    async function sendDataToBackendMelody() {
        if (selectedMeasureIds.length === 0) {
            alert("Please select at least one measure first!");
            return;
        }
        
        if (generationState.active) return;
    
        generationState.active = true;
        currentProposals = [];
        currentProposalIndex = ORIGINAL_INDEX;
    
        // Store initial state and selection
        generationState.originalMEIBackup = originalMEI;
        generationState.selectedMeasureIdsAtStart = [...selectedMeasureIds];
        generationState.selectedMeasureNumbersAtStart = [...selectedMeasureNumbers];
        
        try {
            // First proposal
            setGeneratingHighlight(true);
            showAndBroadcastOverlay("Generating proposal 1/2...");
            const firstProposal = await processMelodyRequest();
            currentProposals.push(firstProposal);
            currentProposalIndex = 0;

            hideGenerationOverlay();
            showProposalSelector();
            updateProposalDisplay();
            broadcastProposals();
        
            
            // Second proposal
            showAndBroadcastOverlay("Generating proposal 2/2...");
            const secondProposal = await processMelodyRequest();
            currentProposals.push(secondProposal);
    
            hideGenerationOverlay();
            showProposalSelector();
            updateProposalDisplay(); 
            broadcastProposals(); 
        } catch (error) {
            console.error("Error generating proposals:", error);
            hideGenerationOverlay();
        } finally {
            generationState.active = false;
        }
    
    }

    async function processMelodyRequest() {
        const midiBase64 = tk.renderToMIDI();
        const midiBlob = base64ToBlob(midiBase64, "audio/midi");
        const formData = new FormData();
        formData.append("midi_file", midiBlob, "full-score.mid");
        formData.append("start_time", selectedStartTime.toString());
        formData.append("end_time", selectedEndTime.toString());
        formData.append("top_p", top_p.toString());
    
        const response = await fetch("https://manuel-l01-inscoreapi.hf.space/uploadchangemelody", {
            method: "POST",
            body: formData,
        });
        const result = await response.json();
    
        if (result.status !== "success") throw new Error(result.message);
    
        const tempTk = new verovio.toolkit();
        tempTk.loadData(result.musicxml);
        return tempTk.getMEI();
    }



    function toggleEditMode() {
        isEditMode = !isEditMode;
        document.getElementById("enterNotes").classList.toggle('active', isEditMode);
        
        if (isEditMode) {
            enableEditMode();
        } else {
            disableEditMode();
        }
    }
    
    function enableEditMode() {
        setupStaffSelection();
        setupDurationKeys();
        setupMIDIInput();
        showDurationDisplay();
    }
    
    function disableEditMode() {
        document.querySelectorAll('.staff-selected').forEach(s => s.classList.remove('staff-selected'));
        selectedStaffId = null;
        hideDurationDisplay();
    }

    function hideGenerationOverlay() {
        document.getElementById('generation-status').classList.add('hidden');
        document.getElementById('ai-controls-row').classList.remove('hidden');
      }
    
    function setupStaffSelection() {
        document.querySelectorAll('#notation .staff').forEach(staff => {
            staff.style.cursor = 'pointer';
            staff.onclick = handleStaffClick;
        });
    }
    
    function handleStaffClick(e) {
        if (!isEditMode) return;
    
        const staff = e.target.closest('.staff');
        if (!staff) return;
    
        document.querySelectorAll('.staff-selected')
                .forEach(s => s.classList.remove('staff-selected'));
    
        staff.classList.add('staff-selected');
        selectedStaffId = staff.id;
    
        staffCleared = false;      
    }
    
    function setupDurationKeys() {
        document.addEventListener('keydown', (e) => {
            if (!isEditMode) return;
            
            const durations = {'1': '1', '2': '2', '3': '4', '4': '8','5':'16'};
            if (durations[e.key]) {
                currentDuration = durations[e.key];
                currentDots = 0; // Reset dots on new duration
                updateDurationDisplay();
                e.preventDefault();
            } else if (e.key === '.') {
                if (currentDuration) {
                    // Cycle between 0, 1, and 2 dots
                    currentDots = (currentDots + 1) % 3;
                    updateDurationDisplay();
                    e.preventDefault();
                }
            }

            if (e.key.toLowerCase() === 'r') {
                isRestInput = !isRestInput;
                updateDurationDisplay();
                e.preventDefault();
            }
        });
    }
    
    function showDurationDisplay() {
        let display = document.getElementById('duration-display');
        if (!display) {
            display = document.createElement('div');
            display.id = 'duration-display';
            display.className = 'note-duration-display';
            document.body.appendChild(display);
        }
        updateDurationDisplay();
    }
    
    function updateDurationDisplay() {
        const display = document.getElementById('duration-display');
        if (display) {
            display.textContent = `Duration: ${currentDuration}${'.'.repeat(currentDots)} | Rest: ${isRestInput ? 'ON' : 'OFF'}`;
        }
    }
    
    function hideDurationDisplay() {
        const display = document.getElementById('duration-display');
        if (display) display.remove();
    }
    
    async function setupMIDIInput() {
        try {
            const access = await navigator.requestMIDIAccess({ sysex: true });
            access.inputs.forEach(input => {
                console.log('MIDI input connected:', input.name);
                input.onmidimessage = handleMIDIMessage;
            });
            
            access.onstatechange = (event) => {
                if (event.port.state === 'connected' && event.port.type === 'input') {
                    event.port.onmidimessage = handleMIDIMessage;
                }
            };
            
        } catch (error) {
            console.error('MIDI access error:', error);
            alert('MIDI access denied. Please connect a MIDI device and reload.');
        }
    }
    
    function handleMIDIStateChange(event) {
        if (event.port.type === 'input' && event.port.connection === 'open') {
            event.port.onmidimessage = handleMIDIMessage;
        }
    }
    
    
    function handleMIDIMessage(message) {
        const [command, note, velocity] = message.data;
        
        // Note-on event (144 = 0x90)
        if (command === 144 && velocity > 0) { 
            // Only process if note wasn't already pressed
            if (!pressedNotes.has(note)) {
                pressedNotes.add(note);
                
                if (isRestInput) {
                    addRestToScore(currentDuration);
                } else {
                    const pitch = convertMIDIToPitch(note);
                    addNoteToScore(pitch, currentDuration);
                }
            }
        }
        // Note-off event (128 = 0x80)
        else if (command === 128 || (command === 144 && velocity === 0)) {
            pressedNotes.delete(note); // Remove from pressed notes
        }
    }

    function addRestToScore(duration) {

        if (generationState.highlightVisible) {
                requestAnimationFrame(() => setGeneratingHighlight(true));
            }

        if (!selectedStaffId || !tk) return;
    
        // Save state for undo
        historyStack.push(originalMEI);
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        redoStack = [];
        updateButtonStates();
    
        try {
            const currentMEI = tk.getMEI();
            const parser = new DOMParser();
            const meiDoc = parser.parseFromString(currentMEI, "text/xml");
            
            // Namespace resolver
            const nsResolver = (prefix) => ({
                'mei': 'http://www.music-encoding.org/ns/mei',
                'xml': 'http://www.w3.org/XML/1998/namespace'
            }[prefix]);
    
            // Find staff element
            const xpath = `//mei:staff[@xml:id="${selectedStaffId}"]`;
            const result = meiDoc.evaluate(
                xpath,
                meiDoc,
                nsResolver,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            const staffElement = result.singleNodeValue;
    
            if (!staffElement) {
                console.error('Staff not found');
                return;
            }
    
            const MEI_NS = 'http://www.music-encoding.org/ns/mei';
            
            // Find or create layer
            let layerElement = staffElement.getElementsByTagNameNS(MEI_NS, 'layer')[0];
            if (!layerElement) {
                layerElement = meiDoc.createElementNS(MEI_NS, 'layer');
                layerElement.setAttribute('xml:id', `layer_${Date.now()}`);
                layerElement.setAttribute('n', '1');
                staffElement.appendChild(layerElement);
            }
            if (!staffCleared) {
                while (layerElement.firstChild) {
                    layerElement.removeChild(layerElement.firstChild);
                }
                staffCleared = true;
            }
    
            // Calculate existing duration in the measure
            let totalDuration = 0;
            Array.from(layerElement.children).forEach(child => {
                if (child.tagName === 'note' || child.tagName === 'rest') {
                    const dur = parseInt(child.getAttribute('dur'));
                    const dots = parseInt(child.getAttribute('dots') || 0);
                    const base = 16 / dur; // Convert to 16th notes
                    totalDuration += base * (2 - Math.pow(0.5, dots));
                }
            });
    
            // Calculate new rest duration
            const newDur = parseInt(currentDuration);
            const base = 16 / newDur;
            const newDuration = base * (2 - Math.pow(0.5, currentDots));
    
            // Get time signature
            const scoreDef = meiDoc.querySelector('scoreDef');
            const meterCount = scoreDef ? parseInt(scoreDef.getAttribute('meter.count')) || 4 : 4;
            const meterUnit = scoreDef ? parseInt(scoreDef.getAttribute('meter.unit')) || 4 : 4;
            const maxDuration = (meterCount * 16) / meterUnit; // Total 16th notes in measure
    
            // Check measure duration
            if (totalDuration + newDuration > maxDuration) {
                alert(`Cannot add rest: Measure duration exceeded! (${totalDuration + newDuration}/${maxDuration} 16th notes)`);
                return;
            }
    
            // Create rest element
            const restElement = meiDoc.createElementNS(MEI_NS, 'rest');
            const restId = `rest_${Date.now()}`;
            restElement.setAttribute('xml:id', restId);
            restElement.setAttribute('dur', currentDuration);
            if (currentDots > 0) {
                restElement.setAttribute('dots', currentDots.toString());
            }
    
            layerElement.appendChild(restElement);
    
            // Update Verovio
            const updatedMEI = new XMLSerializer().serializeToString(meiDoc);
            tk.loadData(updatedMEI);
            originalMEI = updatedMEI;
    
            // Refresh display
            tk.redoLayout();
            document.getElementById('notation').innerHTML = tk.renderToSVG(1);
            setupMeasureInteraction();
            if (isEditMode) setupStaffSelection();
    
        } catch (error) {
            console.error('Error adding rest:', error);
        }
    }
    
    function convertMIDIToPitch(midiNote) {
        const octave = Math.floor(midiNote / 12) - 1;
        const notes = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
        const noteIndex = midiNote % 12;
        const noteName = notes[noteIndex];
        
        return {
            pname: noteName[0].toLowerCase(),
            oct: octave.toString(),
            accid: noteName.length > 1 ? 'f' : null // 'f' for flat
        };
    }
    
    
    function addNoteToScore(pitch, duration) {

        if (generationState.highlightVisible) {
                requestAnimationFrame(() => setGeneratingHighlight(true));
            }
        if (!selectedStaffId || !tk) return;
    
        // Save state for undo
        historyStack.push(originalMEI);
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        redoStack = [];
        updateButtonStates();
    
        try {
            const currentMEI = tk.getMEI();
            const parser = new DOMParser();
            const meiDoc = parser.parseFromString(currentMEI, "text/xml");
            
            // Namespace resolver
            const nsResolver = (prefix) => ({
                'mei': 'http://www.music-encoding.org/ns/mei',
                'xml': 'http://www.w3.org/XML/1998/namespace'
            }[prefix]);
    
            // Find staff element
            const xpath = `//mei:staff[@xml:id="${selectedStaffId}"]`;
            const result = meiDoc.evaluate(
                xpath,
                meiDoc,
                nsResolver,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            );
            const staffElement = result.singleNodeValue;
    
            if (!staffElement) {
                console.error('Staff not found');
                return;
            }
    
            const MEI_NS = 'http://www.music-encoding.org/ns/mei';
            
            // Find or create layer
            let layerElement = staffElement.getElementsByTagNameNS(MEI_NS, 'layer')[0];
            if (!layerElement) {
                layerElement = meiDoc.createElementNS(MEI_NS, 'layer');
                layerElement.setAttribute('xml:id', `layer_${Date.now()}`);
                layerElement.setAttribute('n', '1');
                staffElement.appendChild(layerElement);
            }
            if (!staffCleared) {                 // first note after staff selection
                while (layerElement.firstChild) {
                    layerElement.removeChild(layerElement.firstChild);   // wipe old content
                }
                staffCleared = true;
            }

            let totalDuration = 0;
            for (const child of layerElement.children) {
                if (child.tagName === 'note' || child.tagName === 'rest') {
                    const dur = parseInt(child.getAttribute('dur'));
                    const dots = parseInt(child.getAttribute('dots') || 0);
                    const base = 16 / dur;
                    const noteDuration = base * (2 - Math.pow(0.5, dots));
                    totalDuration += noteDuration;
                }
            }
            // Calculate new note duration
            const newDur = parseInt(currentDuration);
            const newBase = 16 / newDur;
            const newDuration = newBase * (2 - Math.pow(0.5, currentDots));

            // Get time signature
            const scoreDef = meiDoc.querySelector('scoreDef');
            const meterCount = scoreDef ? parseInt(scoreDef.getAttribute('meter.count')) || 4 : 4;
            const meterUnit = scoreDef ? parseInt(scoreDef.getAttribute('meter.unit')) || 4 : 4;
            const maxDuration = (meterCount * 16) / meterUnit;

            if (totalDuration + newDuration > maxDuration) {
                alert('Cannot add note: measure duration exceeded!');
                return;
            }

            // Create note element with accid and dots
            const noteElement = meiDoc.createElementNS(MEI_NS, 'note');
            noteElement.setAttribute('xml:id', `note_${Date.now()}`);
            noteElement.setAttribute('pname', pitch.pname);
            noteElement.setAttribute('oct', pitch.oct);
            noteElement.setAttribute('dur', currentDuration);
            if (pitch.accid) {
                noteElement.setAttribute('accid', pitch.accid);
            }
            if (currentDots > 0) {
                noteElement.setAttribute('dots', currentDots.toString());
            }

    
            layerElement.appendChild(noteElement);
    
            // Update Verovio
            const updatedMEI = new XMLSerializer().serializeToString(meiDoc);
            tk.loadData(updatedMEI);
            originalMEI = updatedMEI;
    
            // Refresh display
            tk.redoLayout();
            document.getElementById('notation').innerHTML = tk.renderToSVG(1);
            setupMeasureInteraction();
            if (isEditMode) setupStaffSelection();
            broadcastUpdate();

        } catch (error) {
            console.error('Error adding note:', error);
        }
    }


    async function addEmptyMeasures() {
        const measureCount = parseInt(document.getElementById("measureCount").value) || 4;
        const parser = new DOMParser();
        const meiDoc = parser.parseFromString(originalMEI, "text/xml");
        
        // Get the score's time signature from scoreDef
        const scoreDef = meiDoc.querySelector('scoreDef');
        const meterCount = scoreDef?.getAttribute('meter.count') || 4;
        const meterUnit = scoreDef?.getAttribute('meter.unit') || 4;
    
        // Find the last measure
        const measures = meiDoc.getElementsByTagName('measure');
        let lastMeasure = measures[measures.length - 1];
        if (!lastMeasure) return;
    
        const MEI_NS = 'http://www.music-encoding.org/ns/mei';
        
        for (let i = 0; i < measureCount; i++) {
            const newMeasure = meiDoc.createElementNS(MEI_NS, 'measure');
            const measureN = parseInt(lastMeasure.getAttribute('n')) + 1;
            newMeasure.setAttribute('n', measureN.toString());
            newMeasure.setAttribute('right', 'single'); // Prevent end symbols
    
            // Add staffs for each part (assuming 4 staves)
            for (let staffNum = 1; staffNum <= 4; staffNum++) {
                const staff = meiDoc.createElementNS(MEI_NS, 'staff');
                staff.setAttribute('n', staffNum.toString());
                const layer = meiDoc.createElementNS(MEI_NS, 'layer');
                layer.setAttribute('n', '1');
                
                // Use mRest for full-measure rest
                const mRest = meiDoc.createElementNS(MEI_NS, 'mRest');
                layer.appendChild(mRest);
                
                staff.appendChild(layer);
                newMeasure.appendChild(staff);
            }
    
            lastMeasure.parentNode.insertBefore(newMeasure, lastMeasure.nextSibling);
            lastMeasure = newMeasure;
        }
    
        originalMEI = new XMLSerializer().serializeToString(meiDoc);
        tk.loadData(originalMEI);
        tk.redoLayout(); // Force Verovio to recalculate layout
        renderScore(originalMEI);
        historyStack.push(originalMEI);
        broadcastUpdate();
    }
    
    async function handleAppendFile(event) {
        const file = event.target.files[0];
        if (!file) return;
    
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const appendTk = new verovio.toolkit();
                
                if (file.name.endsWith('.mxl')) {
                    appendTk.loadZipDataBuffer(e.target.result);
                } else {
                    appendTk.loadData(e.target.result);
                }
                
                const appendMEI = appendTk.getMEI();
                const combinedMEI = mergeMEI(originalMEI, appendMEI);
                
                historyStack.push(originalMEI);
                originalMEI = combinedMEI;
                
                renderScore(originalMEI);
                broadcastUpdate();
                
                // Reset input to allow same file re-selection
                event.target.value = null; 
                
            } catch (error) {
                console.error("Error appending file:", error);
                alert("Error appending file. Make sure it's valid MusicXML");
            }
        };
    
        if (file.name.endsWith('.mxl')) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    }
    
    function mergeMEI(originalMEI, appendMEI) {
        const parser = new DOMParser();
        const originalDoc = parser.parseFromString(originalMEI, "text/xml");
        const appendDoc = parser.parseFromString(appendMEI, "text/xml");
    
        // Get the original section and last measure
        const originalSection = originalDoc.querySelector('section');
        const appendSection = appendDoc.querySelector('section');
        if (!originalSection || !appendSection) return originalMEI;
    
        // Get the last measure of the original to adjust its right barline
        const originalMeasures = originalSection.getElementsByTagName('measure');
        if (originalMeasures.length > 0) {
            const lastOriginalMeasure = originalMeasures[originalMeasures.length - 1];
            lastOriginalMeasure.setAttribute('right', 'single');
        }
    
        // Find the last scoreDef in appendMEI to use for local changes
        const appendScoreDef = appendDoc.querySelector('scoreDef');
        if (appendScoreDef) {
            const localScoreDef = originalDoc.importNode(appendScoreDef.cloneNode(true), true);
            
            const existingLocalScoreDefs = originalSection.querySelectorAll('scoreDef');
            existingLocalScoreDefs.forEach(def => def.remove());
            
            originalSection.appendChild(localScoreDef);
        }
    
        // Append new measures
        const appendMeasures = appendSection.getElementsByTagName('measure');
        Array.from(appendMeasures).forEach(measure => {
            const importedMeasure = originalDoc.importNode(measure.cloneNode(true), true);
            originalSection.appendChild(importedMeasure);
        });
    
        // Re-number ALL measures sequentially (existing + new)
        const allMeasures = originalSection.getElementsByTagName('measure');
        Array.from(allMeasures).forEach((measure, index) => {
            measure.setAttribute('n', (index + 1).toString()); 
        });
    
        return new XMLSerializer().serializeToString(originalDoc);
    }

    const nextPageHandler = () => {
        currentPage = Math.min(currentPage + 1, tk.getPageCount());
        notationElement.innerHTML = tk.renderToSVG(currentPage);
    
        setupMeasureInteraction();          // measure click / highlight
        if (isEditMode) setupStaffSelection(); // staff selection while in edit mode
    };
    
    const prevPageHandler = () => {
        currentPage = Math.max(currentPage - 1, 1);
        notationElement.innerHTML = tk.renderToSVG(currentPage);
    
        setupMeasureInteraction();
        if (isEditMode) setupStaffSelection();
    };
        

    async function playWithTone(midiBase64, offset = 0) {
        // Start AudioContext if needed
        await Tone.start();
        
        // Initialize piano sampler if not already created
        if (!pianoSampler) {
            pianoSampler = new Tone.Sampler({
                urls: {
                    C1: "C1.mp3",
                    C2: "C2.mp3",
                    C3: "C3.mp3",
                    C4: "C4.mp3",
                    C5: "C5.mp3",
                    C6: "C6.mp3",
                    C7: "C7.mp3",
                },
                baseUrl: "https://tonejs.github.io/audio/salamander/",
                release: 1,
                onload: () => {
                    samplesLoaded = true;
                    console.log("Piano samples loaded");
                },
                onerror: (error) => {
                    console.error("Error loading samples:", error);
                }
            }).chain(new Tone.Reverb(1.0), Tone.Destination)
            .toDestination();
    
            
        }
    
        // Wait for samples to load if they're not ready
        if (!samplesLoaded) {
            alert("Please wait - piano samples are still loading...");
            return;
        }
    
        // Reset Transport
        Tone.Transport.stop();
        Tone.Transport.cancel(0);
        Tone.Transport.position = 0;
    
        // Decode MIDI
        const { Midi } = window;
        const midi = new Midi(base64ToUint8(midiBase64));
    
        const now = Tone.now() + 0.25; // Small look-ahead
        
        if (currentPart) currentPart.dispose();   
        currentPart = new Tone.Part((time, n) => {
            pianoSampler.triggerAttackRelease(n.name, n.duration, time, n.velocity);
            midiHightlightingHandler({ time: n.time });
        },
        midi.tracks.flatMap(t => t.notes.map(n => [n.time, n])))
            .start(0);                 // begin with the first note
        currentPart.loop = false;

        Tone.Transport.start();
            }
            
            // Update the stop handler
            function stopTonePlayback() {
                Tone.Transport.stop();
                Tone.Transport.cancel();     // removes highlight + any remaining notes
                if (currentPart) {
                currentPart.stop();
                currentPart.dispose();
                currentPart = null;
                }
                if (pianoSampler) pianoSampler.releaseAll(true);
                document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
    }

    function base64ToUint8(base64) {
        const bin = atob(base64);
        return Uint8Array.from([...bin].map(c => c.charCodeAt(0)));
    }

    
function showGenerationOverlay(text) {
    const statusEl = document.getElementById('generation-status');
    const statusTextEl = document.getElementById('generation-status-text');
    const proposalSelectorEl = document.getElementById('proposal-selector');
    const aiControlsRow = document.getElementById('ai-controls-row');
    
    statusTextEl.textContent = text;
    statusEl.classList.remove('hidden');
    proposalSelectorEl.classList.add('hidden');
    aiControlsRow.classList.add('hidden');
}
    

    function showProposalSelector() {
        hideGenerationOverlay();
        const selectorEl = document.getElementById('proposal-selector');
        selectorEl.classList.remove('hidden');
        updateProposalDisplay();
    }
    
    function hideProposalSelector() {
        const proposalSelectorEl = document.getElementById('proposal-selector');
        const aiControlsRow = document.getElementById('ai-controls-row');
        
        proposalSelectorEl.classList.add('hidden');
        aiControlsRow.classList.remove('hidden');
    }


    function updateProposalDisplay() {
        const proposalIndexSpan = document.getElementById('proposal-index');
        const generationStatusEl = document.getElementById('generation-status');
        const proposalSelectorEl = document.getElementById('proposal-selector');
        const aiControlsRow = document.getElementById('ai-controls-row');

        
        if (currentProposalIndex === ORIGINAL_INDEX) {
            proposalIndexSpan.textContent = `Original/${currentProposals.length}`;
        } else {
            proposalIndexSpan.textContent = `${currentProposalIndex + 1}/${currentProposals.length}`;
        }
    
        if (currentProposalIndex === ORIGINAL_INDEX) {
            currentDisplayMEI = originalMEI;
            renderScore(currentDisplayMEI);
            setGeneratingHighlight(true);
            proposalIndexSpan.textContent = `Original/${currentProposals.length}`;
            generationStatusEl.classList.add('hidden');
            proposalSelectorEl.classList.remove('hidden');
            aiControlsRow.classList.add('hidden');
            return;
        }
    
        const proposalMEI = currentProposals[currentProposalIndex];
        currentDisplayMEI = originalMEI;
    
        generationState.selectedMeasureNumbersAtStart.forEach(measureNumber => {
            currentDisplayMEI = replaceMeasureInMEI(
                currentDisplayMEI,
                proposalMEI,
                measureNumber.toString()
            );
        });
    
        renderScore(currentDisplayMEI);
        setGeneratingHighlight(true);
        proposalIndexSpan.textContent = `${currentProposalIndex + 1}/${currentProposals.length}`;
        generationStatusEl.classList.add('hidden');
        proposalSelectorEl.classList.remove('hidden');
        aiControlsRow.classList.add('hidden');
    }
    
    let currentDisplayMEI = originalMEI;  


 

    
   

    
      
     

    function getMeasureViewportPosition(measureId) {
        // Get the SVG container
        const svgContainer = document.getElementById('notation');
        if (!svgContainer) return null;
    
        // Get measure element
        const measureEl = document.getElementById(measureId);
        if (!measureEl) return null;
    
        // Get bounding boxes
        const containerRect = svgContainer.getBoundingClientRect();
        const measureRect = measureEl.getBoundingClientRect();
    
        // Calculate position relative to SVG container
        return {
            left: measureRect.left - containerRect.left,
            top: measureRect.top - containerRect.top,
            width: measureRect.width,
            height: measureRect.height
        };
    }

    function hideGenerationOverlay() {
        const statusEl = document.getElementById('generation-status');
        const aiControlsRow = document.getElementById('ai-controls-row');
        
        statusEl.classList.add('hidden');
        aiControlsRow.classList.remove('hidden');
    }

    function setGeneratingHighlight(on) {
        generationState.highlightVisible = on;
        // Get all measures
        const measures = Array.from(document.querySelectorAll("#notation g.measure"));
        
        // Find measures by their measure number
        const targetMeasures = measures.filter(measure => {
            const n = parseInt(tk.getElementAttr(measure.id).n);
            return generationState.selectedMeasureNumbersAtStart.includes(n);
        });

        
        targetMeasures.forEach(measure => {
            if (on) {
                measure.classList.add('generating');
            } else {
                measure.classList.remove('generating');
            }
        });
    }

    function updateConnectionStatus(connected, peerId = null) {
    // Always show the status element
        connectionStatusElement.classList.remove('hidden');
        
        if (connected) {
            statusLight.classList.remove('status-offline');
            statusLight.classList.add('status-online');
            statusText.textContent = peerId ? `Connected to ${peerId}` : 'Connected';
        } else {
            statusLight.classList.remove('status-online');
            statusLight.classList.add('status-offline');
            statusText.textContent = 'Offline';
        }
    }

    

});