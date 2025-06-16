

def load_midi_metadata(midi_file):
        
        original_tempo = 500000  # default tempo (120 BPM)
        original_time_sig = (4, 4)  # default time signature

        for msg in midi_file:
            if msg.type == 'set_tempo':
                original_tempo = msg.tempo
            elif msg.type == 'time_signature':
                original_time_sig = (msg.numerator, msg.denominator)

        return midi_file, original_tempo, original_time_sig

