from memory import get_all_videos


videos = get_all_videos()

print("\n====================================")
print("        AI TIKTOK MEMORY")
print("====================================\n")

if not videos:
    print("No videos stored yet.")

else:

    for video in videos:

        video_id = video[0]
        topic = video[1]
        word_count = video[2]
        status = video[3]
        video_path = video[4]
        created_at = video[5]

        print(f"VIDEO #{video_id}")
        print(f"Topic: {topic}")
        print(f"Words: {word_count}")
        print(f"Status: {status}")
        print(f"Video: {video_path}")
        print(f"Created: {created_at}")
        print("------------------------------------")

print()