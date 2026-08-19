import sqlite3
from pathlib import Path
from datetime import datetime


PROJECT_ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE = DATA_DIR / "agent.db"


def get_connection():
    return sqlite3.connect(DATABASE)


def initialize_database():
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic TEXT NOT NULL,
            script TEXT NOT NULL,
            word_count INTEGER,
            status TEXT DEFAULT 'approved',
            video_path TEXT,
            created_at TEXT NOT NULL
        )
        """
    )

    connection.commit()
    connection.close()


def save_video(
    topic,
    script,
    word_count,
    status="approved",
    video_path=None,
):
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        INSERT INTO videos (
            topic,
            script,
            word_count,
            status,
            video_path,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            topic,
            script,
            word_count,
            status,
            video_path,
            datetime.now().isoformat(timespec="seconds"),
        ),
    )

    connection.commit()

    video_id = cursor.lastrowid

    connection.close()

    return video_id


def topic_exists(topic):
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT id
        FROM videos
        WHERE LOWER(topic) = LOWER(?)
        LIMIT 1
        """,
        (topic,),
    )

    result = cursor.fetchone()

    connection.close()

    return result is not None


def get_all_videos():
    connection = get_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT
            id,
            topic,
            script,
            word_count,
            status,
            video_path,
            created_at
        FROM videos
        ORDER BY id DESC
        """
    )

    results = cursor.fetchall()

    connection.close()

    return results


if __name__ == "__main__":
    initialize_database()

    print("Database initialized.")
    print(f"Database: {DATABASE}")