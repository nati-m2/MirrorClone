"""
MirrorClone - Rclone Mirror Wrapper
Entry point for development

For production, use Docker:
    docker-compose up -d

For development:
    uvicorn app.main:app --reload
"""

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
