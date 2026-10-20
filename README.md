# DevOps Sample Node.js App

## Overview

A lightweight Node.js application. It features basic web endpoints, Prometheus metrics integration, and is designed for Kubernetes deployment and CI/CD pipeline demonstrations.

## Features

- Express.js web server
- Prometheus metrics integration
- Readiness and liveness probe endpoints
- Customizable port via environment variable

## Prerequisites

- Node.js (v24.19.0)


## localy validate you have mimimal npm version which requered in the pre-req: npm version

## install project dependencies from package-lock.json

npm ci        # Install Express, prom-client, and their dependencies
node app.js   # Start your application

## from browser run
http://127.0.0.1:8080/my-app

## and get metrics (in browser: http://127.0.0.1:8080/metrics ) or powershell:
##see root_access_total 1 - increase when user opened /myapp

curl http://127.0.0.1:8080/metrics
