'use strict';

const http = require('http');
const path = require('path');
const vscode = require('vscode');

function workspaceInfo() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return folder ? { project: folder.name, cwd: folder.uri.fsPath } : { project: null, cwd: null };
}

function runtimeName() {
  return /cursor/i.test(vscode.env.appName) ? 'cursor' : 'vscode';
}

function post(eventType, fields = {}) {
  const body = Buffer.from(JSON.stringify({
    eventType, runtime: runtimeName(), timestamp: new Date().toISOString(),
    ...workspaceInfo(), ...fields
  }));
  const request = http.request({
    hostname: '127.0.0.1', port: 19280, path: '/events', method: 'POST', timeout: 750,
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
  });
  request.on('error', () => {});
  request.on('timeout', () => request.destroy());
  request.end(body);
}

function activate(context) {
  post('ide.session.started', { description: vscode.env.appName });
  context.subscriptions.push(
    vscode.commands.registerCommand('vibemonLocal.sendHeartbeat', () => post('ide.heartbeat')),
    vscode.workspace.onDidChangeWorkspaceFolders(() => post('ide.workspace.changed')),
    vscode.window.onDidOpenTerminal(terminal => post('ide.terminal.opened', { description: terminal.name })),
    vscode.window.onDidCloseTerminal(terminal => post('ide.terminal.closed', { description: terminal.name })),
    vscode.workspace.onDidSaveTextDocument(document => post('ide.document.saved', {
      files: document.uri.scheme === 'file' ? [path.resolve(document.uri.fsPath)] : []
    })),
    vscode.tasks.onDidStartTaskProcess(event => post('ide.task.started', { description: event.execution.task.name })),
    vscode.tasks.onDidEndTaskProcess(event => post('ide.task.ended', {
      description: event.execution.task.name, success: event.exitCode === 0
    }))
  );
}

function deactivate() {
  post('ide.session.ended');
}

module.exports = { activate, deactivate };
