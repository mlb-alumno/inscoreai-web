from agents.harmonize import harmonizer, infiller, change_melody
from flask import Flask, request, jsonify
from flask_cors import CORS
import mido
import tempfile
import os
import music21
import traceback
from uuid import uuid4

app = Flask(__name__)
CORS(app)

def midi_to_musicxml(midi_file_path):
    """Convert MIDI file to MusicXML string with absolute safety"""
    try:
        midi_path_str = str(midi_file_path)
        
        # Parse and convert to MusicXML
        score = music21.converter.parse(midi_path_str)
        
        # Create temporary output file path
        temp_output = os.path.join(tempfile.gettempdir(), f"output_{uuid4().hex}.musicxml")
        
        # Write to temporary file
        score.write('musicxml', temp_output)
        
        # Read back as string
        with open(temp_output, 'r') as f:
            musicxml_str = f.read()
            
        # Clean up
        os.unlink(temp_output)
        
        return musicxml_str
    except Exception as e:
        print(f"Conversion error: {str(e)}")
        traceback.print_exc()
        raise

@app.route('/upload', methods=['POST'])
def handle_upload():
    temp_midi_path = None
    top_p = float(request.form.get('top_p', '0.95'))

    try:
        # Validate input
        if 'midi_file' not in request.files:
            return jsonify({"status": "error", "message": "No MIDI file provided"}), 400
        
        midi_file = request.files['midi_file']
        start_time = request.form.get('start_time', '0')
        end_time = request.form.get('end_time', '0')

        # Create temporary MIDI file with random name
        temp_dir = tempfile.gettempdir()
        temp_midi_path = os.path.join(temp_dir, f"temp_{uuid4().hex}.mid")
        
        # Save uploaded MIDI to temp file
        midi_file.save(temp_midi_path)

        # Process MIDI
        midi = mido.MidiFile(temp_midi_path)
        harmonized_midi = harmonizer(midi, int(start_time)/1000, int(end_time)/1000,top_p=top_p)
        
        # Save harmonized MIDI (overwriting temp file)
        harmonized_midi.save(temp_midi_path)

        # Convert to MusicXML string
        musicxml_str = midi_to_musicxml(temp_midi_path)
        
        # Final type verification
        if not isinstance(musicxml_str, str):
            raise TypeError(f"Expected string but got {type(musicxml_str)}")
        
        return jsonify({
            "status": "success",
            "musicxml": musicxml_str
        })

    except Exception as e:
        print(f"Error processing request: {str(e)}")
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400
    finally:
        # Clean up temp file
        if temp_midi_path and os.path.exists(temp_midi_path):
            try:
                os.unlink(temp_midi_path)
            except Exception as e:
                print(f"Warning: Could not remove {temp_midi_path}: {str(e)}")

@app.route('/uploadinfill', methods=['POST'])
def handle_upload_infilling():
    temp_midi_path = None
    top_p = float(request.form.get('top_p', '0.95'))

    try:
        # Validate input
        if 'midi_file' not in request.files:
            return jsonify({"status": "error", "message": "No MIDI file provided"}), 400
        
        midi_file = request.files['midi_file']
        start_time = request.form.get('start_time', '0')
        end_time = request.form.get('end_time', '0')

        # Create temporary MIDI file with random name
        temp_dir = tempfile.gettempdir()
        temp_midi_path = os.path.join(temp_dir, f"temp_{uuid4().hex}.mid")
        
        # Save uploaded MIDI to temp file
        midi_file.save(temp_midi_path)

        # Process MIDI
        midi = mido.MidiFile(temp_midi_path)
        infilled_midi = infiller(midi, int(start_time)/1000, int(end_time)/1000,top_p=top_p)
        
        # Save harmonized MIDI (overwriting temp file)
        infilled_midi.save(temp_midi_path)

        # Convert to MusicXML string
        musicxml_str = midi_to_musicxml(temp_midi_path)
        
        # Final type verification
        if not isinstance(musicxml_str, str):
            raise TypeError(f"Expected string but got {type(musicxml_str)}")
        
        return jsonify({
            "status": "success",
            "musicxml": musicxml_str
        })

    except Exception as e:
        print(f"Error processing request: {str(e)}")
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400
    finally:
        # Clean up temp file
        if temp_midi_path and os.path.exists(temp_midi_path):
            try:
                os.unlink(temp_midi_path)
            except Exception as e:
                print(f"Warning: Could not remove {temp_midi_path}: {str(e)}")

@app.route('/uploadchangemelody', methods=['POST'])
def handle_upload_changemelody():
    temp_midi_path = None
    top_p = float(request.form.get('top_p', '0.95'))

    try:
        # Validate input
        if 'midi_file' not in request.files:
            return jsonify({"status": "error", "message": "No MIDI file provided"}), 400
        
        midi_file = request.files['midi_file']
        start_time = request.form.get('start_time', '0')
        end_time = request.form.get('end_time', '0')

        # Create temporary MIDI file with random name
        temp_dir = tempfile.gettempdir()
        temp_midi_path = os.path.join(temp_dir, f"temp_{uuid4().hex}.mid")
        
        # Save uploaded MIDI to temp file
        midi_file.save(temp_midi_path)

        # Process MIDI
        midi = mido.MidiFile(temp_midi_path)
        changed_melody_midi = change_melody(midi, int(start_time)/1000, int(end_time)/1000,top_p=top_p)
        
        # Save harmonized MIDI (overwriting temp file)
        changed_melody_midi.save(temp_midi_path)

        # Convert to MusicXML string
        musicxml_str = midi_to_musicxml(temp_midi_path)
        
        # Final type verification
        if not isinstance(musicxml_str, str):
            raise TypeError(f"Expected string but got {type(musicxml_str)}")
        
        return jsonify({
            "status": "success",
            "musicxml": musicxml_str
        })

    except Exception as e:
        print(f"Error processing request: {str(e)}")
        traceback.print_exc()
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 400
    finally:
        # Clean up temp file
        if temp_midi_path and os.path.exists(temp_midi_path):
            try:
                os.unlink(temp_midi_path)
            except Exception as e:
                print(f"Warning: Could not remove {temp_midi_path}: {str(e)}")


if __name__ == '__main__':
    app.run(debug=True, port=5000)