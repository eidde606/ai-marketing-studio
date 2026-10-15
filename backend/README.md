# Backend

## Setup

From the project root, create and activate a Python virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate
```

On Windows:

```powershell
.venv\Scripts\Activate.ps1
```

Install the backend requirements:

```bash
python -m pip install -r backend/requirements.txt
```

## Run the server

From the project root:

```bash
uvicorn app.main:app --app-dir backend --reload
```

Alternatively, run Uvicorn with `backend` as the working directory:

```bash
cd backend
uvicorn app.main:app --reload
```

## Health check

The server provides:

```text
GET /health
```

Check it locally at:

```text
http://127.0.0.1:8000/health
```

A healthy response is:

```json
{"status":"healthy"}
```
