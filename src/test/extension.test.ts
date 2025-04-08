import * as assert from 'assert';
import * as vscode from 'vscode';
import { convertBytes } from '../utils';
import { TextureEditorProvider } from '../textureEditor';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

  test('convertBytes should correctly format bytes', () => {
    const result = convertBytes(1024);
    assert.strictEqual(result.value, 1);
    assert.strictEqual(result.unit, 'KB');
    assert.strictEqual(result.formatted, '1KB');
  });

  test('TextureEditorProvider should handle "size" message correctly', () => {
    const mockStatusBarItem = {
      text: '',
      show: () => {},
      hide: () => {}
    } as unknown as vscode.StatusBarItem;

    const provider = new TextureEditorProvider({ subscriptions: [], extensionUri: vscode.Uri.parse('') } as any as vscode.ExtensionContext);
    provider.statusBarItem = mockStatusBarItem;

    const mockDocument = {
      documentData: new Uint8Array(1024)
    } as any;

    const message = {
      type: 'size',
      body: { width: 1920, height: 1080 }
    } as any;

    provider['onMessage']({ webview: {} } as any, mockDocument, message);

    assert.strictEqual(mockStatusBarItem.text, '1920x1080   1KB');
  });  
});
