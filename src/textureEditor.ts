import * as vscode from 'vscode';
import { extname } from 'node:path';
import { Disposable } from './dispose';
import { getNonce, convertBytes } from './utils';

interface TextureEdit { }

interface TextureMessage {
  type: 'ready' | 'size' | 'error';
  body: any;
}

class TextureDocument extends Disposable implements vscode.CustomDocument {

  private readonly _uri: vscode.Uri;

  private _documentData: Uint8Array;

  private _edits: TextureEdit[] = [];
  private _savedEdits: TextureEdit[] = [];

  private constructor(uri: vscode.Uri, initialContent: Uint8Array) {
    super();
    this._uri = uri;
    this._documentData = initialContent;
  }

  static async create(uri: vscode.Uri, backupId: string | undefined): Promise<TextureDocument | PromiseLike<TextureDocument>> {
    const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
    const fileData = await TextureDocument.readFile(dataFile);
    return new TextureDocument(uri, fileData);
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme === 'untitled') {
      return new Uint8Array();
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  public get uri() {
    return this._uri;
  }

  public get documentData() {
    return this._documentData;
  }

  private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());

  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
    readonly content?: Uint8Array;
    readonly edits: readonly TextureEdit[];
  }>());
  /**
   * Fired to notify webviews that the document has changed.
   */
  public readonly onDidChangeContent = this._onDidChangeDocument.event;

  private readonly _onDidChange = this._register(new vscode.EventEmitter<{
    readonly label: string,
    undo(): void,
    redo(): void,
  }>());

  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  /**
   * Called when the user edits the document in a webview.
   *
   * This fires an event to notify VS Code that the document has been edited.
   */
  makeEdit(edit: TextureEdit) {
    this._edits.push(edit);

    this._onDidChange.fire({
      label: 'Stroke',
      undo: async () => {
        this._edits.pop();
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      },
      redo: async () => {
        this._edits.push(edit);
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      }
    });
  }

  /**
   * Called by VS Code when the user saves the document.
   */
  async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
    this._savedEdits = Array.from(this._edits);
  }

  /**
   * Called by VS Code when the user saves the document to a new location.
   */
  async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
    if (cancellation.isCancellationRequested) {
      return;
    }
  }

  /**
   * Called by VS Code when the user calls `revert` on a document.
   */
  async revert(_cancellation: vscode.CancellationToken): Promise<void> {
    const diskContent = await TextureDocument.readFile(this.uri);
    this._documentData = diskContent;
    this._edits = this._savedEdits;
    this._onDidChangeDocument.fire({
      content: diskContent,
      edits: this._edits,
    });
  }

  /**
   * Called by VS Code to backup the edited document.
   *
   * These backups are used to implement hot exit.
   */
  async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // noop
        }
      }
    };
  }
}

export class TextureEditorProvider implements vscode.CustomEditorProvider<TextureDocument> {
  public statusBarItem: vscode.StatusBarItem;

  private static readonly viewType = 'ktx-hdr.preview';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      TextureEditorProvider.viewType,
      new TextureEditorProvider(context),
      {
        supportsMultipleEditorsPerDocument: false,
      });
  }

  constructor(private readonly _context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    this._context.subscriptions.push(this.statusBarItem);
  }

  //#region CustomEditorProvider

  async openCustomDocument(uri: vscode.Uri, openContext: { backupId?: string }, _token: vscode.CancellationToken): Promise<TextureDocument> {

    const document: TextureDocument = await TextureDocument.create(uri, openContext.backupId);

    document.onDidDispose(() => {
      this.statusBarItem.hide();
    });

    return document;
  }

  async resolveCustomEditor(document: TextureDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._context.extensionUri, 'media')]
    };

    webviewPanel.onDidDispose(() => {
      this.statusBarItem.hide();
    });

    webviewPanel.onDidChangeViewState((e) => {
      if (!e.webviewPanel.active) {
        this.statusBarItem.hide();
      }
    });

    webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(webviewPanel, document, e));

    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
  }

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<TextureDocument>>();

  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  public saveCustomDocument(document: TextureDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.save(cancellation);
  }

  public saveCustomDocumentAs(document: TextureDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(document: TextureDocument, cancellation: vscode.CancellationToken): Thenable<void> {
    return document.revert(cancellation);
  }

  public backupCustomDocument(document: TextureDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  //#endregion

  /**
   * Get the static HTML used for in our editor's webviews.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Local path to script and css for the webview
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._context.extensionUri, 'media', 'index.css'));

    const scriptMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
      this._context.extensionUri, 'media', 'js', 'main.js'));

    // Use a nonce to whitelist which scripts can be run
    const nonce = getNonce();

    return /* html */`
			<!DOCTYPE html>
			<html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta
            http-equiv="Content-Security-Policy"
            content="default-src 'none';
            connect-src ${webview.cspSource} https: data: blob:; 
            img-src ${webview.cspSource} blob: https:; 
            style-src ${webview.cspSource}; 
            script-src 'nonce-${nonce}' 'unsafe-eval';
            worker-src 'nonce-${nonce}' blob:;">

          <meta name="viewport" content="width=device-width, initial-scale=1.0">

          <link href="${styleMainUri}" rel="stylesheet" />

          <title>KTX & HDR Preview</title>
        </head>
        <body>
          <div class="viewer-container loading">
            <div class="loading-indicator"></div>
            <div class="file-load-error">
              <p>An error occurred while loading the file.</p>
            </div>
            <img class="viewer-image" alt="Preview" />
          </div>
          <script nonce="${nonce}" src="${scriptMainUri}"></script>
        </body>
			</html>`;
  }

  private postMessage(panel: vscode.WebviewPanel, type: string, body: any) {
    panel.webview.postMessage({ type, body });
  }

  private onMessage(panel: vscode.WebviewPanel, document: TextureDocument, message: TextureMessage) {
    switch (message.type) {
      case 'ready': {
        const data = document.documentData;
        const extension = extname(document.uri.fsPath).replace('.', '');
        const body = { extension, data: {} };

        if (extension === 'hdr') {
          Object.assign(body, { data });
        }
        else if (extension === 'ktx' || extension === 'ktx2') {
          const basisUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'media', 'basis/'));
          Object.assign(body, {
            data: {
              ktxContent: data,
              transcoderPath: basisUri.toString()
            }
          });
        }

        this.postMessage(panel, 'update', body);

        return;
      }

      case 'size': {
        const { width, height } = message.body;
        const { formatted } = convertBytes(document.documentData.byteLength);

        this.statusBarItem.text = `${width}x${height}   ${formatted}`;
        this.statusBarItem.show();

        return;
      }

      case 'error': {
        const { message: errorMessage } = message.body;
        this.statusBarItem.hide();
        vscode.window.showErrorMessage(`[KTX-HDR Viewer]: ${errorMessage}`);

        return;
      }
    }
  }
}
