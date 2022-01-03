/* global __dirname, process */

const {
    BrowserWindow,
    Menu,
    app,
    ipcMain,
    systemPreferences,
    dialog
} = require('electron');

const os = require('os');
const Badge = require('./app/features/windows-badge');

const contextMenu = require('electron-context-menu');
const debug = require('electron-debug');
const isDev = require('electron-is-dev');
const { autoUpdater } = require('electron-updater');
const windowStateKeeper = require('electron-window-state');
const {
    initPopupsConfigurationMain,
    getPopupTarget,
    setupAlwaysOnTopMain,
    setupPowerMonitorMain,
    setupScreenSharingMain
} = require('jifmeet-electron-utils');
const { openSystemPreferences } = require('electron-util');
const path = require('path');
const URL = require('url');
const config = require('./app/features/config');
const { openExternalLink } = require('./app/features/utils/openExternalLink');
const pkgJson = require('./package.json');

const showDevTools = Boolean(process.env.SHOW_DEV_TOOLS) || (process.argv.indexOf('--show-dev-tools') > -1);

// We need this because of https://github.com/electron/electron/issues/18214
app.commandLine.appendSwitch('disable-site-isolation-trials');

// We need to disable hardware acceleration because its causes the screenshare to flicker.
app.commandLine.appendSwitch('disable-gpu');

// Needed until robot.js is fixed: https://github.com/octalmage/robotjs/issues/580
app.allowRendererProcessReuse = false;

autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// Enable context menu so things like copy and paste work in input fields.
contextMenu({
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    showCopyImage: false,
    showCopyImageAddress: false,
    showSaveImage: false,
    showSaveImageAs: false,
    showInspectElement: true,
    showServices: false
});

// Enable DevTools also on release builds to help troubleshoot issues. Don't
// show them automatically though.
debug({
    isEnabled: true,
    showDevTools
});

/**
 * When in development mode:
 * - Enable automatic reloads
 */
if (isDev) {
    require('electron-reload')(path.join(__dirname, 'build'));
}

/**
 * The window object that will load the iframe with Jitsi Meet.
 * IMPORTANT: Must be defined as global in order to not be garbage collected
 * acidentally.
 */
let mainWindow = null;

/**
 * Add protocol data
 */
const appProtocolSurplus = `${config.default.appProtocolPrefix}://`;
let rendererReady = false;
let protocolDataForFrontApp = null;


/**
 * Sets the application menu. It is hidden on all platforms except macOS because
 * otherwise copy and paste functionality is not available.
 */
function setApplicationMenu() {
    if (process.platform === 'darwin') {
        const template = [ {
            label: app.name,
            submenu: [
                {
                    role: 'services',
                    submenu: []
                },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideothers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }, {
            label: 'Edit',
            submenu: [ {
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            },
            {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            },
            {
                type: 'separator'
            },
            {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            },
            {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            },
            {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            },
            {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            } ]
        }, {
            label: '&Window',
            role: 'window',
            submenu: [
                { role: 'minimize' },
                { role: 'close' }
            ]
        } ];

        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } else {
        Menu.setApplicationMenu(null);
    }
}

/**
 * Opens new window with index.html(Jitsi Meet is loaded in iframe there).
 */
function createJitsiMeetWindow() {
    // Application menu.
    setApplicationMenu();

    if (process.platform === 'win32')
    {
        app.setAppUserModelId(app.name);
    }

    // set feedURL for testing the private repo
    /*autoUpdater.setFeedURL({
        provider: 'github',
        repo: 'blync-meet-electron',
        owner: 'saaltech',
        private: true,
        token: '<token>'
    })*/

    // Check for Updates.
    autoUpdater.checkForUpdatesAndNotify();

    // Load the previous window state with fallback to defaults.
    const windowState = windowStateKeeper({
        defaultWidth: 1220,
        defaultHeight: 800
    });

    // Path to root directory.
    const basePath = isDev ? __dirname : app.getAppPath();

    // URL for index.html which will be our entry point.
    const indexURL = URL.format({
        pathname: path.resolve(basePath, './build/index.html'),
        protocol: 'file:',
        slashes: true
    });
    // const indexURL = 'https://localhost:8080/'

    // Options used when creating the main Jitsi Meet window.
    // Use a preload script in order to provide node specific functionality
    // to a isolated BrowserWindow in accordance with electron security
    // guideline.
    const options = {
        x: windowState.x,
        y: windowState.y,
        width: windowState.width,
        height: windowState.height,
        icon: path.resolve(basePath, './resources/icon.png'),
        minWidth: 1220,
        minHeight: 800,
        show: false,
        webPreferences: {
            enableBlinkFeatures: 'RTCInsertableStreams',
            enableRemoteModule: true,
            nativeWindowOpen: true,
            nodeIntegration: true,
            preload: path.resolve(basePath, './build/preload.js')
        }
    };

    mainWindow = new BrowserWindow(options);

    if(os.platform() === "win32") {
        const badgeOptions = {}
        new Badge(mainWindow, badgeOptions);
    }

    windowState.manage(mainWindow);
    mainWindow.loadURL(indexURL);

    initPopupsConfigurationMain(mainWindow);
    setupAlwaysOnTopMain(mainWindow);
    setupPowerMonitorMain(mainWindow);

    mainWindow.webContents.on('new-window', (event, url, frameName) => {
        const target = getPopupTarget(url, frameName);

        if (!target || target === 'browser') {
            event.preventDefault();
            openExternalLink(url);
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    mainWindow.once('ready-to-show', async () => {
        let options = {
            type: 'info',
            buttons: ['Quit', 'Open system preferences'],
            defaultId: 1,
            cancelId: 0,
            detail: "Jifmeet requires access to the camera, microphone, and permission to record the screen for the video call to work effectively."
        };
        
        let cameraPermission = systemPreferences.getMediaAccessStatus('camera');
        let micPermission = systemPreferences.getMediaAccessStatus('microphone');
        let screen = systemPreferences.getMediaAccessStatus('screen');

        // Can be one of the following 
        // 'not-determined', 'granted', 'denied', 'restricted' or 'unknown'
        // Windows OS doesnt need permission to access camera, microphone or screen per app.
        // Its a device leel setting on windows.
       
        if(cameraPermission !== 'granted') {
            let success = await systemPreferences.askForMediaAccess('camera');
            // let success = isDev ? false : await systemPreferences.askForMediaAccess('camera');
            if(!(success === true || success === 'granted')) {
                maximizeWindow();
                // if(isDev) {
                //     return
                // }
                options.message = "Jifmeet requires access to the camera";
                dialog.showMessageBox(mainWindow, options)
                .then(result => {
                    if(result.response === 0) {
                        // quit app if `Quit is clicked`
                        app.quit();
                        process.exit(0);
                    }
                    else {
                        openSystemPreferences('security', 'Privacy_Camera');
                        mainWindow.close();
                    }
                });
                return;
            }
        }

        if(micPermission !== 'granted') {
            let success = await systemPreferences.askForMediaAccess('microphone');
            if(!(success === true  || success === 'granted')) {
                maximizeWindow();
                options.message = "Jifmeet requires access to the microphone";
                dialog.showMessageBox(mainWindow, options)
                .then(result => {
                    if(result.response === 0) {
                        // quit app if `Quit is clicked`
                        app.quit();
                        process.exit(0);
                    }
                    else {
                        openSystemPreferences('security', 'Privacy_Microphone');
                        mainWindow.close();
                    }
                });
                return;
            }
        }
        
        if(screen !== 'granted') {
            maximizeWindow();
            options.message = "Jifmeet requires access to the screen capture/record capability";
            dialog.showMessageBox(mainWindow, options)
            .then(result => {
                if(result.response === 0) {
                    // quit app if `Quit is clicked`
                    app.quit();
                    process.exit(0);
                }
                else {
                    openSystemPreferences('security', 'Privacy_ScreenCapture');
                    mainWindow.close();
                }
            });
            return;
        }
        else {
            setupScreenSharingMain.setup(mainWindow, config.default.appName, pkgJson.build.appId);
        }
        
        maximizeWindow();
    });

    /**
     * When someone tries to enter something like jitsi-meet://test
     *  while app is closed
     * it will trigger this event below
     */
    handleProtocolCall(process.argv.pop());
}

function maximizeWindow() {
    mainWindow.maximize();
    mainWindow.show();
}

/**
 * Handler for application protocol links to initiate a conference.
 */
function handleProtocolCall(fullProtocolCall) {
    // don't touch when something is bad
    if (
        !fullProtocolCall
        || fullProtocolCall.trim() === ''
        || fullProtocolCall.indexOf(appProtocolSurplus) !== 0
    ) {
        return;
    }

    const inputURL = fullProtocolCall.replace(appProtocolSurplus, '');

    if (app.isReady() && mainWindow === null) {
        createJitsiMeetWindow();
    }

    protocolDataForFrontApp = inputURL;

    if (rendererReady) {
        mainWindow
            .webContents
            .send('protocol-data-msg', inputURL);
    }
}

/**
 * Force Single Instance Application.
 */
const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
    app.quit();
    process.exit(0);
}

/**
 * Run the application.
 */

app.on('activate', () => {
    if (mainWindow === null) {
        createJitsiMeetWindow();
    }
});

app.on('certificate-error',
    // eslint-disable-next-line max-params
    (event, webContents, url, error, certificate, callback) => {
        if (isDev) {
            event.preventDefault();
            callback(true);
        } else {
            callback(false);
        }
    }
);

app.on('ready', createJitsiMeetWindow);

app.on('second-instance', (event, commandLine) => {
    /**
     * If someone creates second instance of the application, set focus on
     * existing window.
     */
    if (mainWindow) {
        mainWindow.isMinimized() && mainWindow.restore();
        mainWindow.focus();

        /**
         * This is for windows [win32]
         * so when someone tries to enter something like jitsi-meet://test
         * while app is opened it will trigger protocol handler.
         */
        handleProtocolCall(commandLine.pop());
    }
});

app.on('window-all-closed', () => {
    // Don't quit the application on macOS.
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// remove so we can register each time as we run the app.
app.removeAsDefaultProtocolClient(config.default.appProtocolPrefix);

// If we are running a non-packaged version of the app && on windows
if (isDev && process.platform === 'win32') {
    // Set the path of electron.exe and your app.
    // These two additional parameters are only available on windows.
    app.setAsDefaultProtocolClient(
        config.default.appProtocolPrefix,
        process.execPath,
        [ path.resolve(process.argv[1]) ]
    );
} else {
    app.setAsDefaultProtocolClient(config.default.appProtocolPrefix);
}

/**
 * This is for mac [darwin]
 * so when someone tries to enter something like jitsi-meet://test
 * it will trigger this event below
 */
app.on('open-url', (event, data) => {
    event.preventDefault();
    handleProtocolCall(data);
});

/**
 * This is to notify main.js [this] that front app is ready to receive messages.
 */
ipcMain.on('renderer-ready', () => {
    rendererReady = true;
    if (protocolDataForFrontApp) {
        mainWindow
            .webContents
            .send('protocol-data-msg', protocolDataForFrontApp);
    }
});

/**
 * This is to notify main.js [this] that front app has asked to trigger
 * screen share if it was denied before.
 */
// ipcMain.on('explicit-screenshare-init', () => {
//     setupScreenSharingMain.setup(mainWindow, config.default.appName, pkgJson.build.appId);
// });
