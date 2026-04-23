.PHONY: help install build dev clean docker-build docker-up docker-down docker-logs test

help:
	@echo "Nati-Backup - Available Commands"
	@echo "================================="
	@echo "install       - Install all dependencies"
	@echo "build         - Build frontend"
	@echo "dev           - Run development servers"
	@echo "clean         - Clean build artifacts"
	@echo "docker-build  - Build Docker image"
	@echo "docker-up     - Start Docker containers"
	@echo "docker-down   - Stop Docker containers"
	@echo "docker-logs   - View Docker logs"
	@echo "test          - Run tests"

install:
	@echo "Installing backend dependencies..."
	pip install -r requirements.txt
	@echo "Installing frontend dependencies..."
	cd frontend && npm install

build:
	@echo "Building frontend..."
	cd frontend && npm run build

dev:
	@echo "Starting development servers..."
	@echo "Backend: http://localhost:8000"
	@echo "Frontend: http://localhost:5173"
	@echo ""
	@echo "Run in separate terminals:"
	@echo "  Terminal 1: python main.py"
	@echo "  Terminal 2: cd frontend && npm run dev"

clean:
	@echo "Cleaning build artifacts..."
	rm -rf frontend/dist
	rm -rf frontend/node_modules
	rm -rf .venv
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

docker-build:
	@echo "Building Docker image..."
	docker-compose build

docker-up:
	@echo "Starting Docker containers..."
	docker-compose up -d
	@echo "Application available at http://localhost:8000"

docker-down:
	@echo "Stopping Docker containers..."
	docker-compose down

docker-logs:
	docker-compose logs -f

test:
	@echo "Running tests..."
	pytest
