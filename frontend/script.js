


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
        selectedMeasuresRect: null
    };
    const ORIGINAL_INDEX = -1;



    const MAX_HISTORY = 10;
    if (historyStack.length > MAX_HISTORY) historyStack.shift();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') isShiftPressed = true;
    });
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') isShiftPressed = false;
    });

    verovio.module.onRuntimeInitialized = async () => {
        tk = new verovio.toolkit();
        console.log("Verovio initialized");
        
        tk.setOptions({
            scale: 85,
            scaleToPageSize: true,
            systemDivider: 'none',            
            footer: "none",                   // Remove footer symbols
        });

        // Load default score
        document.getElementById("loadDefault").addEventListener("click", loadLocalMusicXML);
        
        // Setup MXL file input
        document.getElementById("mxlFile").addEventListener("change", handleFileUpload);
        
        // Download handlers
        document.getElementById("downloadMeasureMidi").addEventListener("click", downloadMeasureMidi);
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

    };

    function undoHandler() {
        if (historyStack.length > 0) {
            redoStack.push(originalMEI);
            originalMEI = historyStack.pop();
            renderScore(originalMEI);
            updateButtonStates();
        }
    }
    
    function redoHandler() {
        if (redoStack.length > 0) {
            historyStack.push(originalMEI);
            originalMEI = redoStack.pop();
            renderScore(originalMEI);
            updateButtonStates();
        }
    }

    function updateButtonStates() {
        document.getElementById("undoButton").disabled = historyStack.length === 0;
        document.getElementById("redoButton").disabled = redoStack.length === 0;
    }

    async function loadLocalMusicXML() {
        try {
            // Path to your MusicXML file relative to your HTML file
            const response = await fetch("example_files/starwarsharm.musicxml");
            const musicXML = await response.text();
            
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
        // Clear previous state
        currentPage = 1;
        selectedMeasureId = null;
        document.getElementById("notation").innerHTML = tk.renderToSVG(1);
        if (isEditMode) setupStaffSelection(); // Re-bind staff clicks
        setupMeasureInteraction();
        
        // Load the MEI data (either original or converted from MXL)
        tk.loadData(meiData);
        document.getElementById("notation").innerHTML = tk.renderToSVG(1);
        setupMeasureInteraction();
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
        
        // Create temporary toolkit instance for MIDI export
        const tempTk = new verovio.toolkit();
        tempTk.loadData(filteredMEI);
        const midiBase64 = tempTk.renderToMIDI();
        const blob = base64ToBlob(midiBase64, "audio/midi");
        saveAs(blob, `measure-${selectedMeasureId}.mid`);
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
        playbackOffset = 0; // Reset offset for full playback
    
        if (selectedMeasureIds.length) {
            const filteredMEI = filterMEIFromSelection(originalMEI, selectedMeasureIds);
            const tempTk = new verovio.toolkit();
            tempTk.loadData(filteredMEI);
            midiBase64 = tempTk.renderToMIDI();
            playbackOffset = selectedStartTime;
        } else {
            midiBase64 = tk.renderToMIDI();
            playbackOffset = 0;
        }
    
        playbackMode = 'full';
        await playWithTone(midiBase64, playbackOffset);
    };
    
    const playSelectionHandler = async function () {
        if (!tk) return;
        if (!selectedMeasureIds.length) return alert("Please select measures first!");
    
        const filteredMEI = filterMEIByMeasures(originalMEI, selectedMeasureIds);
        const tempTk = new verovio.toolkit();
        tempTk.loadData(filteredMEI);
    
        playbackMode = 'selection';
        playbackOffset = selectedStartTime;
        await playWithTone(tempTk.renderToMIDI(), selectedStartTime);
        
    };
    
    const stopMIDIHandler = stopTonePlayback;
    
    const midiHightlightingHandler = function (event) {
        // Remove previous highlights
        document.querySelectorAll('.playing').forEach(note => {
            note.classList.remove('playing');
        });
    
        if (!tk) return;
    
        const currentTime = event.time * 1000 + playbackOffset; // Correctly add offset once
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

    
    // Update the stop handler
    

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
        currentProposalIndex = 0;
    
        // Store initial state and selection
        generationState.originalMEIBackup = originalMEI;
        generationState.selectedMeasureIdsAtStart = [...selectedMeasureIds];
        generationState.selectedMeasureNumbersAtStart = [...selectedMeasureNumbers];
        const measures = document.querySelectorAll('.highlighted');
        const rects = Array.from(measures).map(m => m.getBoundingClientRect());
        generationState.selectedMeasuresRect = {
            left: Math.min(...rects.map(r => r.left)),
            top: Math.min(...rects.map(r => r.top)) - 40,
            width: Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left))
        };
    
        try {
            // First proposal
            showGenerationOverlay("Generating proposal 1/2...", generationState.selectedMeasuresRect);
            const firstProposal = await processHarmonyRequest();
            currentProposals.push(firstProposal);
            currentProposalIndex = 0;
            updateProposalDisplay();
            generationState.overlayElement?.remove();
            showProposalSelector();
    
            // Second proposal
            showGenerationOverlay("Generating proposal 2/2...", generationState.selectedMeasuresRect);
            const secondProposal = await processHarmonyRequest();
            currentProposals.push(secondProposal);
            generationState.overlayElement?.remove();
            showProposalSelector();
        } catch (error) {
            console.error("Error generating proposals:", error);
            generationState.overlayElement?.remove();
           
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
    
        const response = await fetch("http://localhost:5000/upload", {
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
        currentProposalIndex = 0;
    
        // Store initial state and selection
        generationState.originalMEIBackup = originalMEI;
        generationState.selectedMeasureIdsAtStart = [...selectedMeasureIds];
        generationState.selectedMeasureNumbersAtStart = [...selectedMeasureNumbers];
        const measures = document.querySelectorAll('.highlighted');
        const rects = Array.from(measures).map(m => m.getBoundingClientRect());
        generationState.selectedMeasuresRect = {
            left: Math.min(...rects.map(r => r.left)),
            top: Math.min(...rects.map(r => r.top)) - 40,
            width: Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left))
        };
    
        try {
            // First proposal
            showGenerationOverlay("Generating proposal 1/2...", generationState.selectedMeasuresRect);
            const firstProposal = await processInfillRequest();
            currentProposals.push(firstProposal);
            currentProposalIndex = 0;
            updateProposalDisplay();
            generationState.overlayElement?.remove();
            showProposalSelector();
    
            // Second proposal
            showGenerationOverlay("Generating proposal 2/2...", generationState.selectedMeasuresRect);
            const secondProposal = await processInfillRequest();
            currentProposals.push(secondProposal);
            generationState.overlayElement?.remove();
            showProposalSelector();
        } catch (error) {
            console.error("Error generating proposals:", error);
            generationState.overlayElement?.remove();
           
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
    
        const response = await fetch("http://localhost:5000/uploadinfill", {
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
        currentProposalIndex = 0;
    
        // Store initial state and selection
        generationState.originalMEIBackup = originalMEI;
        generationState.selectedMeasureIdsAtStart = [...selectedMeasureIds];
        generationState.selectedMeasureNumbersAtStart = [...selectedMeasureNumbers];
        const measures = document.querySelectorAll('.highlighted');
        const rects = Array.from(measures).map(m => m.getBoundingClientRect());
        generationState.selectedMeasuresRect = {
            left: Math.min(...rects.map(r => r.left)),
            top: Math.min(...rects.map(r => r.top)) - 40,
            width: Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left))
        };
    
        try {
            // First proposal
            showGenerationOverlay("Generating proposal 1/2...", generationState.selectedMeasuresRect);
            const firstProposal = await processMelodyRequest();
            currentProposals.push(firstProposal);
            currentProposalIndex = 0;
            updateProposalDisplay();
            generationState.overlayElement?.remove();
            showProposalSelector();
    
            // Second proposal
            showGenerationOverlay("Generating proposal 2/2...", generationState.selectedMeasuresRect);
            const secondProposal = await processMelodyRequest();
            currentProposals.push(secondProposal);
            generationState.overlayElement?.remove();
            showProposalSelector();
        } catch (error) {
            console.error("Error generating proposals:", error);
            generationState.overlayElement?.remove();
           
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
    
        const response = await fetch("http://localhost:5000/uploadchangemelody", {
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
    
    // Update setupDurationKeys to handle '3' and '.' keys
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
                    currentDots = Math.min(currentDots + 1, 2); // Allow up to 2 dots
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
            if (isRestInput) {
                addRestToScore(currentDuration);
            } else {
                const pitch = convertMIDIToPitch(note);
                addNoteToScore(pitch, currentDuration);
            }
        }
        // Note-off event (128 = 0x80)
        else if (command === 128) {
            // Handle note-off if needed
        }
    }

    function addRestToScore(duration) {
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
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const noteIndex = midiNote % 12;
        const noteName = notes[noteIndex];
        return {
            pname: noteName[0].toLowerCase(),
            oct: octave.toString(),
            accid: noteName.includes('#') ? 's' : null // 's' for sharp
        };
    }
    
    
    function addNoteToScore(pitch, duration) {
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

    
            // ADD NOTE TO END OF EXISTING CONTENT
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
                
                // Reset input to allow same file re-selection
                event.target.value = null;  // 🆕 Add this line
                
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
            
            // 🆕 Remove existing local scoreDefs to prevent duplicates
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
            measure.setAttribute('n', (index + 1).toString());  // 🆕 Starts from 1
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
        
        if (currentPart) currentPart.dispose();    // get rid of an old part
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

    function showGenerationOverlay(text, rect) {
        if (generationState.overlayElement) {
            generationState.overlayElement.remove();
        }
    
        if (!rect) {
            const measures = document.querySelectorAll('.highlighted');
            if (measures.length === 0) return;
            const rects = Array.from(measures).map(m => m.getBoundingClientRect());
            rect = {
                left: Math.min(...rects.map(r => r.left)),
                top: Math.min(...rects.map(r => r.top)) - 40,
                width: Math.max(...rects.map(r => r.right)) - Math.min(...rects.map(r => r.left))
            };
        }
    
        const overlay = document.createElement('div');
        overlay.className = 'generating-overlay';
        overlay.style.left = `${rect.left + window.scrollX}px`;
        overlay.style.top = `${rect.top + window.scrollY}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.innerHTML = text;
    
        document.body.appendChild(overlay);
        generationState.overlayElement = overlay;
    }
    
    function showProposalSelector() {
        const selector = document.createElement('div');
        selector.className = 'proposal-selector';
        const rect = generationState.selectedMeasuresRect;
        selector.style.left = `${rect.left + window.scrollX}px`;
        selector.style.top = `${rect.top + window.scrollY - 50}px`;
        
        selector.innerHTML = `
            <div class="proposal-nav" id="prev-proposal">←</div>
            <span>${currentProposalIndex + 1}/${currentProposals.length}</span>
            <div class="proposal-nav" id="next-proposal">→</div>
            <div class="proposal-accept">✓</div>
            <div class="proposal-reject">✕</div>
        `;
    
        // Navigation arrows
        selector.querySelector('#prev-proposal').addEventListener('click', () => {
            if (currentProposalIndex === ORIGINAL_INDEX) {
                currentProposalIndex = currentProposals.length - 1;   // wrap to last
            } else if (currentProposalIndex === 0) {
                currentProposalIndex = ORIGINAL_INDEX;                // show original
            } else {
                currentProposalIndex--;
            }
            updateProposalDisplay();
        });
        selector.querySelector('#next-proposal').addEventListener('click', () => {
            if (currentProposalIndex === ORIGINAL_INDEX) {
                currentProposalIndex = 0;                              // original → first
            } else if (currentProposalIndex === currentProposals.length - 1) {
                currentProposalIndex = ORIGINAL_INDEX;                // wrap to original
            } else {
                currentProposalIndex++;
            }
            updateProposalDisplay();
        });
    
        // Accept button
        selector.querySelector('.proposal-accept').addEventListener('click', () => {
            historyStack.push(generationState.originalMEIBackup);
            if (historyStack.length > MAX_HISTORY) historyStack.shift();
            updateButtonStates();
            generationState.overlayElement?.remove();
            generationState.overlayElement = null;
        });
    
        // Reject button
        selector.querySelector('.proposal-reject').addEventListener('click', () => {
            originalMEI = generationState.originalMEIBackup;
            renderScore(originalMEI);
            generationState.overlayElement?.remove();
            generationState.overlayElement = null;
        });
    
        document.body.appendChild(selector);
        generationState.overlayElement = selector;
    }
    
    
    function updateProposalDisplay() {
        // ① ORIGINAL
        if (currentProposalIndex === ORIGINAL_INDEX) {
            renderScore(generationState.originalMEIBackup);
    
            // update the little “0/2” indicator
            if (
                generationState.overlayElement &&
                generationState.overlayElement.classList.contains('proposal-selector')
            ) {
                const span = generationState.overlayElement.querySelector('span');
                if (span) span.textContent = `0/${currentProposals.length}`;
            }
            return;            // done
        }
    
        // ② PROPOSALS
        if (currentProposals.length === 0) return;   // safety guard
    
        let updatedMEI = generationState.originalMEIBackup;
        const proposalMEI  = currentProposals[currentProposalIndex];
    
        generationState.selectedMeasureNumbersAtStart.forEach(measureNumber => {
            updatedMEI = replaceMeasureInMEI(
                updatedMEI,
                proposalMEI,
                measureNumber.toString()
            );
        });
    
        renderScore(updatedMEI);
    
        // update “1/2”, “2/2”, …
        if (
            generationState.overlayElement &&
            generationState.overlayElement.classList.contains('proposal-selector')
        ) {
            const span = generationState.overlayElement.querySelector('span');
            if (span) span.textContent =
                `${currentProposalIndex + 1}/${currentProposals.length}`;
        }
    }

});