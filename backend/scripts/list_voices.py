#!/usr/bin/env python3
"""List available ElevenLabs voices for character-voice mapping.

Usage:
    ELEVENLABS_API_KEY=your_key python backend/scripts/list_voices.py
"""

import os
import sys

from elevenlabs import ElevenLabs


def main() -> None:
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("Set ELEVENLABS_API_KEY environment variable.", file=sys.stderr)
        sys.exit(1)

    client = ElevenLabs(api_key=api_key)
    response = client.voices.get_all()

    print(f"{'VOICE ID':<28} {'NAME':<30} {'GENDER':<8} {'ACCENT':<15} {'AGE':<12} {'USE CASE':<20}")
    print("-" * 113)

    for voice in sorted(response.voices, key=lambda v: v.name or ""):
        labels = dict(voice.labels) if voice.labels else {}
        print(
            f"{voice.voice_id:<28} "
            f"{(voice.name or '-'):<30} "
            f"{labels.get('gender', '-'):<8} "
            f"{labels.get('accent', '-'):<15} "
            f"{labels.get('age', '-'):<12} "
            f"{labels.get('use_case', '-'):<20}"
        )

    print(f"\nTotal: {len(response.voices)} voices")


if __name__ == "__main__":
    main()
