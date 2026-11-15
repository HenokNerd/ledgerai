import time
import sys

print("Starting 1-minute background task...", flush=True)
for i in range(60):
    print(f"Elapsed: {i + 1}s", flush=True)
    time.sleep(1)
print("Done! 1-minute task completed successfully.", flush=True)
