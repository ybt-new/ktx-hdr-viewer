import * as vscode from 'vscode';
import { TextureEditorProvider } from './textureEditor'; 

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(TextureEditorProvider.register(context));
}
