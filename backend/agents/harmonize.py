import sys,time
import midi2audio
import transformers
from transformers import AutoModelForCausalLM

from IPython.display import Audio

from anticipation import ops
from anticipation.sample import generate
from anticipation.tokenize import extract_instruments
from anticipation.convert import events_to_midi,midi_to_events, compound_to_midi
from anticipation.visuals import visualize
from anticipation.config import *
from anticipation.vocab import *
import subprocess
import pretty_midi
import soundfile as sf
from anticipation.convert import midi_to_compound
import mido
from music21 import converter, environment
from agents.utils import load_midi_metadata
import threading

MODEL = None
MODEL_LOCK = threading.Lock()

def get_model():
    global MODEL
    with MODEL_LOCK:
        if MODEL is None:
            MODEL = AutoModelForCausalLM.from_pretrained(SMALL_MODEL)
    return MODEL

SMALL_MODEL = 'stanford-crfm/music-small-800k'     # faster inference, worse sample quality
MEDIUM_MODEL = 'stanford-crfm/music-medium-800k'   # slower inference, better sample quality
LARGE_MODEL = 'stanford-crfm/music-large-800k'     # slowest inference, best sample quality




def harmonize_midi(model, midi, start_time, end_time,original_tempo,original_time_sig,top_p):

    # Turn full midi to events
    events = midi_to_events(midi)

    print("Midi converted to events")

    # Get clip from 0 to end of full midi 

    segment = ops.clip(events, 0, ops.max_time(events, seconds=True))
    segment = ops.translate(segment, -ops.min_time(segment, seconds=False))
    
    # Extract melody and accompaniment
    events, melody = extract_instruments(segment, [0])

    print("Melody extracted")

    print("Start time:", start_time)
    print("End time:", end_time)

    # Get initial prompt
    history = ops.clip(events, 0, start_time, clip_duration=False)

    anticipated = [CONTROL_OFFSET + tok for tok in ops.clip(events, end_time, ops.max_time(segment, seconds=True), clip_duration=False)]

    # Generate accompaniment conditioning on melody
    accompaniment = generate(model, start_time, end_time, inputs=history, controls=melody, top_p=top_p, debug=False)
    
    # Append anticipated continuation to accompaniment
    accompaniment = ops.combine(accompaniment, anticipated)

    print("Accompaniment generated")

    # 1) render each voice separately
    mel_mid = events_to_midi(melody)
    acc_mid = events_to_midi(accompaniment)

    # 2) build a fresh MidiFile
    combined = mido.MidiFile()
    combined.ticks_per_beat = mel_mid.ticks_per_beat  # or TIME_RESOLUTION//2

    print("Midi built")

    # 3) meta‐track with tempo & time signature
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage('set_tempo', tempo=original_tempo))
    meta.append(mido.MetaMessage('time_signature',
                                numerator=original_time_sig[0],
                                denominator=original_time_sig[1]))
    combined.tracks.append(meta)

    # 4) append melody *then* accompaniment
    combined.tracks.extend(mel_mid.tracks[1:])  # Skip existing meta track
    combined.tracks.extend(acc_mid.tracks[1:])
    # 5) save in exactly that order
        
    for track in combined.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                # Ensure valid MIDI values
                if hasattr(msg, 'velocity'):
                    msg.velocity = min(max(msg.velocity, 0), 127)
                if hasattr(msg, 'note'):
                    msg.note = min(max(msg.note, 0), 127)  
    
    print(f"Melody tracks: {len(mel_mid.tracks)}")
    print(f"Accompaniment tracks: {len(acc_mid.tracks)}")
    print(f"Combined tracks before cleanup: {len(combined.tracks)}")

    # Add track cleanup (keep only unique tracks):
    unique_tracks = []
    seen = set()
    for track in combined.tracks:
        track_hash = str([msg.hex() for msg in track])
        if track_hash not in seen:
            unique_tracks.append(track)
            seen.add(track_hash)
    combined.tracks = unique_tracks

    print(f"Final track count: {len(combined.tracks)}")
        
    print("Output Midi metadata added")

    return combined
    


def harmonizer(midi_file, start_time, end_time,top_p):
    """
    this function harmonizes a melody in a MIDI file
    returns the harmonized MIDI

    Args:
    midi_file: path to the MIDI file
    start_time: start time of the selected measure (melody you want to harmonize) in milliseconds
    end_time: end time of the selected measure in milliseconds
    """

    print(f"Original MIDI tracks: {len(midi_file.tracks)}")
    
    # Load metadata and model...
    
    # Log original note parameters
    for track in midi_file.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                if msg.velocity > 127 or msg.velocity < 0:
                    print(f"Invalid velocity: {msg.velocity}")
                if msg.note > 127 or msg.note < 0:
                    print(f"Invalid pitch: {msg.note}")


    # Load original MIDI and extract metadata
    midi, original_tempo, original_time_sig = load_midi_metadata(midi_file)

    print("Midi metadata loaded")

    # load an anticipatory music transformer
    model = get_model() # add .cuda() if you have a GPU

    print("Model loaded")

    harmonized_midi = harmonize_midi(model, midi, start_time, end_time, original_tempo,original_time_sig,top_p)
    
    print("Midi generated")

    print(f"Harmonized MIDI tracks: {len(harmonized_midi.tracks)}")
    
    # Add MIDI validation
    for track in harmonized_midi.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                # Clamp invalid values
                msg.velocity = min(max(msg.velocity, 0), 127)
                msg.note = min(max(msg.note, 0), 127)

    print("Midi saved")

    return harmonized_midi

def infill_midi(model, midi, start_time, end_time,original_tempo,original_time_sig,top_p):

    # Turn full midi to events
    events = midi_to_events(midi)

    print("Midi converted to events")

    # Get clip from 0 to end of full midi 

    segment = ops.clip(events, 0, ops.max_time(events, seconds=True))
    segment = ops.translate(segment, -ops.min_time(segment, seconds=False))

    # Get initial prompt
    history = ops.clip(events, 0, start_time, clip_duration=False)

    anticipated = [CONTROL_OFFSET + tok for tok in ops.clip(events, end_time, ops.max_time(segment, seconds=True), clip_duration=False)]

    # Generate accompaniment conditioning on melody
    infilling = generate(model, start_time, end_time, inputs=history, controls=anticipated, top_p=top_p, debug=False)
    
    # Append anticipated continuation to accompaniment
    full_events = ops.combine(infilling, anticipated)

    print("Accompaniment generated")

    # 1) render each voice separately
    full_mid = events_to_midi(full_events)

    # 2) build a fresh MidiFile
    combined = mido.MidiFile()
    combined.ticks_per_beat = full_mid.ticks_per_beat  # or TIME_RESOLUTION//2

    print("Midi built")

    # 3) meta‐track with tempo & time signature
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage('set_tempo', tempo=original_tempo))
    meta.append(mido.MetaMessage('time_signature',
                                numerator=original_time_sig[0],
                                denominator=original_time_sig[1]))
    combined.tracks.append(meta)

    # 4) append melody *then* accompaniment
    combined.tracks.extend(full_mid.tracks[:])  # Skip existing meta track

    # 5) save in exactly that order
        
    for track in combined.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                # Ensure valid MIDI values
                if hasattr(msg, 'velocity'):
                    msg.velocity = min(max(msg.velocity, 0), 127)
                if hasattr(msg, 'note'):
                    msg.note = min(max(msg.note, 0), 127)  
    
    print(f"Melody tracks: {len(full_mid.tracks)}")
    print(f"Accompaniment tracks: {len(full_mid.tracks)}")
    print(f"Combined tracks before cleanup: {len(combined.tracks)}")

    # Add track cleanup (keep only unique tracks):
    unique_tracks = []
    seen = set()
    for track in combined.tracks:
        track_hash = str([msg.hex() for msg in track])
        if track_hash not in seen:
            unique_tracks.append(track)
            seen.add(track_hash)
    combined.tracks = unique_tracks

    print(f"Final track count: {len(combined.tracks)}")
        
    print("Output Midi metadata added")

    return combined
    


def infiller(midi_file, start_time, end_time,top_p):
    """
    this function harmonizes a melody in a MIDI file
    returns the harmonized MIDI

    Args:
    midi_file: path to the MIDI file
    start_time: start time of the selected measure (melody you want to harmonize) in milliseconds
    end_time: end time of the selected measure in milliseconds
    """

    print(f"Original MIDI tracks: {len(midi_file.tracks)}")
    
    # Load metadata and model...
    
    # Log original note parameters
    for track in midi_file.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                if msg.velocity > 127 or msg.velocity < 0:
                    print(f"Invalid velocity: {msg.velocity}")
                if msg.note > 127 or msg.note < 0:
                    print(f"Invalid pitch: {msg.note}")


    # Load original MIDI and extract metadata
    midi, original_tempo, original_time_sig = load_midi_metadata(midi_file)

    print("Midi metadata loaded")

    # load an anticipatory music transformer
    model = get_model() # add .cuda() if you have a GPU

    print("Model loaded")

    infilled_midi = infill_midi(model, midi, start_time, end_time, original_tempo,original_time_sig,top_p)
    
    print("Midi generated")

    print(f"Harmonized MIDI tracks: {len(infilled_midi.tracks)}")
    
    # Add MIDI validation
    for track in infilled_midi.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                # Clamp invalid values
                msg.velocity = min(max(msg.velocity, 0), 127)
                msg.note = min(max(msg.note, 0), 127)

    print("Midi saved")

    return infilled_midi

def change_melody_midi(model, midi, start_time, end_time,original_tempo,original_time_sig,top_p):

    events = midi_to_events(midi)
    segment = ops.clip(events, 0, ops.max_time(events, seconds=True))
    segment = ops.translate(segment, -ops.min_time(segment, seconds=False))

    # Extract melody (instrument 0) as events and accompaniment as controls
    instruments = list(ops.get_instruments(segment).keys())
    accompaniment_instruments = [instr for instr in instruments if instr != 0]
    melody_events, accompaniment_controls = extract_instruments(segment, accompaniment_instruments)

    # Get initial prompt (melody before start_time)
    history = ops.clip(melody_events, 0, start_time, clip_duration=False)
    
    # Include accompaniment controls for the entire duration
    controls = accompaniment_controls  # Full accompaniment as controls

    # Generate new melody conditioned on accompaniment
    infilling = generate(model, start_time, end_time, inputs=history, controls=controls, top_p=top_p, debug=False)
    
    # Append anticipated continuation
    anticipated_melody = [CONTROL_OFFSET + tok for tok in ops.clip(melody_events, end_time, ops.max_time(segment, seconds=True), clip_duration=False)]
    full_events = ops.combine(infilling, anticipated_melody)

    acc_mid = events_to_midi(accompaniment_controls)


    # Render and combine MIDI tracks
    full_mid = events_to_midi(full_events)
    combined = mido.MidiFile()
    combined.ticks_per_beat = full_mid.ticks_per_beat  # or TIME_RESOLUTION//2

    print("Midi built")

    # 3) meta‐track with tempo & time signature
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage('set_tempo', tempo=original_tempo))
    meta.append(mido.MetaMessage('time_signature',
                                numerator=original_time_sig[0],
                                denominator=original_time_sig[1]))
    combined.tracks.append(meta)

    # 4) append melody *then* accompaniment
    combined.tracks.extend(full_mid.tracks[:])  # Skip existing meta track
    combined.tracks.extend(acc_mid.tracks[:])  # Skip existing meta track

    # 5) save in exactly that order
        
    for track in combined.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                # Ensure valid MIDI values
                if hasattr(msg, 'velocity'):
                    msg.velocity = min(max(msg.velocity, 0), 127)
                if hasattr(msg, 'note'):
                    msg.note = min(max(msg.note, 0), 127)  
    
    print(f"Melody tracks: {len(full_mid.tracks)}")
    print(f"Accompaniment tracks: {len(full_mid.tracks)}")
    print(f"Combined tracks before cleanup: {len(combined.tracks)}")

    # Add track cleanup (keep only unique tracks):
    unique_tracks = []
    seen = set()
    for track in combined.tracks:
        track_hash = str([msg.hex() for msg in track])
        if track_hash not in seen:
            unique_tracks.append(track)
            seen.add(track_hash)
    combined.tracks = unique_tracks

    print(f"Final track count: {len(combined.tracks)}")
        
    print("Output Midi metadata added")

    return combined
    


def change_melody(midi_file, start_time, end_time,top_p):
    """
    this function harmonizes a melody in a MIDI file
    returns the harmonized MIDI

    Args:
    midi_file: path to the MIDI file
    start_time: start time of the selected measure (melody you want to harmonize) in milliseconds
    end_time: end time of the selected measure in milliseconds
    """

    print(f"Original MIDI tracks: {len(midi_file.tracks)}")
    
    # Load metadata and model...
    
    # Log original note parameters
    for track in midi_file.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                if msg.velocity > 127 or msg.velocity < 0:
                    print(f"Invalid velocity: {msg.velocity}")
                if msg.note > 127 or msg.note < 0:
                    print(f"Invalid pitch: {msg.note}")


    # Load original MIDI and extract metadata
    midi, original_tempo, original_time_sig = load_midi_metadata(midi_file)

    print("Midi metadata loaded")

    # load an anticipatory music transformer
    model = get_model() # add .cuda() if you have a GPU

    print("Model loaded")

    change_melody_gen_midi = change_melody_midi(model, midi, start_time, end_time, original_tempo,original_time_sig,top_p)
    
    print("Midi generated")

    print(f"Harmonized MIDI tracks: {len(change_melody_gen_midi.tracks)}")
    
    # Add MIDI validation
    for track in change_melody_gen_midi.tracks:
        for msg in track:
            if msg.type in ['note_on', 'note_off']:
                # Clamp invalid values
                msg.velocity = min(max(msg.velocity, 0), 127)
                msg.note = min(max(msg.note, 0), 127)

    print("Midi saved")

    

    return change_melody_gen_midi