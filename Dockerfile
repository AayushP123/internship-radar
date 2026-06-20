FROM python:3.13-slim

WORKDIR /app
COPY monitor.py config.json companies.json ./

ENV PYTHONUNBUFFERED=1
CMD ["python", "monitor.py", "--loop", "--interval", "120"]

