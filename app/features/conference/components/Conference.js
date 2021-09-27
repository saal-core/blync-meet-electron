// @flow

import Spinner from '@atlaskit/spinner';

import React, { Component } from 'react';
import type { Dispatch } from 'redux';
import { connect } from 'react-redux';
import { push } from 'react-router-redux';

import i18n from '../../../i18n';
import config from '../../config';
import { getSetting, setEmail, setName } from '../../settings';

import { conferenceEnded, conferenceJoined } from '../actions';
import JitsiMeetExternalAPI from '../external_api';
import { LoadingIndicator, Wrapper } from '../styled';
import Loading from '../../always-on-top/Loading';
import { createConferenceObjectFromURL, createMeetingWindow, getServerURL } from '../../utils';

const electron = window.require('electron');

const ENABLE_REMOTE_CONTROL = false;

type Props = {

    /**
     * Redux dispatch.
     */
    dispatch: Dispatch<*>;

    /**
     * React Router location object.
     */
    location: Object;

    /**
     * AlwaysOnTop Window Enabled.
     */
    _alwaysOnTopWindowEnabled: boolean;

    /**
     * Email of user.
     */
    _email: string;

    /**
     * Name of user.
     */
    _name: string;

    /**
     * Default Jitsi Server URL.
     */
    _serverURL: string;

    /**
     * Default Jitsi Server Timeout.
     */
    _serverTimeout: number;

    /**
     * Start with Audio Muted.
     */
    _startWithAudioMuted: boolean;

    /**
     * Start with Video Muted.
     */
    _startWithVideoMuted: boolean;
};

type State = {

    /**
     * If the conference is loading or not.
     */
    isLoading: boolean;

    loadingMsg: string;
};

/**
 * Conference component.
 */
class Conference extends Component<Props, State> {
    /**
     * External API object.
     */
    _api: Object;

    /**
     * Conference Object.
     */
    _conference: Object;

    /**
     * Timer to cancel the joining if it takes too long.
     */
    _loadTimer: ?TimeoutID;

    /**
     * Reference to the element of this component.
     */
    _ref: Object;

    /**
     * Initializes a new {@code Conference} instance.
     *
     * @inheritdoc
     */
    constructor() {
        super();

        this.state = {
            isLoading: true,
            loadingMsg: ''
        };

        this._ref = React.createRef();

        this._onIframeLoad = this._onIframeLoad.bind(this);
        this._onVideoConferenceEnded = this._onVideoConferenceEnded.bind(this);
        this._onExplicitIframeReload = this._onExplicitIframeReload.bind(this);
        this._updateAppBadge = this._updateAppBadge.bind(this);
        this._invokeMeetingWindow = this._invokeMeetingWindow.bind(this);
        // this._onExplicitScreenshareInit = this._onExplicitScreenshareInit.bind(this);
    }

    /**
     * Attach the script to this component.
     *
     * @returns {void}
     */
    componentDidMount() {
        const room = this.props.location.state.room;
        const serverTimeout = this.props._serverTimeout || config.defaultServerTimeout;
        const serverURL = this.props.location.state.serverURL
            || this.props._serverURL
            || getServerURL();

        if(this.props.location.state.loadingMsg) {
            this.setState({
                loadingMsg: this.props.location.state.loadingMsg
            });
        }

        this._conference = {
            room,
            serverURL
        };

        this._loadConference();

        // Set a timer for a timeout duration, if we haven't loaded the iframe by then,
        // give up.
        this._loadTimer = setTimeout(() => {
            this._navigateToHome(

                // $FlowFixMe
                {
                    error: 'Loading error',
                    type: 'error'
                },
                room,
                serverURL);
        }, serverTimeout * 1000);
    }

    /**
     * Keep profile settings in sync with Conference.
     *
     * @param {Props} prevProps - Component's prop values before update.
     * @returns {void}
     */
    componentDidUpdate(prevProps) {
        // const { props } = this;

        // if (props._email !== prevProps._email) {
        //     this._setEmail(props._email);
        // }
        // if (props._name !== prevProps._name) {
        //     this._setName(props._name);
        // }
    }

    /**
     * Remove conference on unmounting.
     *
     * @returns {void}
     */
    componentWillUnmount() {
        if (this._loadTimer) {
            clearTimeout(this._loadTimer);
        }
        if (this._api) {
            this._api.dispose();
        }
    }

    // _onExplicitScreenshareInit: (*) => void;

    /**
     * Explicit screen share reset(show dialog) if permission was not allowed/denied.
     *
     * @param {Object} obj - data with serverURL in it.
     * @returns {void}
     * @private
     */
    // _onExplicitScreenshareInit() {
        // send notification to main process
        //ask for screenshare permission once done it wont be asked again
        // window.jitsiNodeAPI.ipc.send('explicit-screenshare-init');
    // }

    _updateAppBadge: (*) => void;

    _updateAppBadge(showBadge) {
        electron.remote?.app?.dock?.setBadge(showBadge ? "•": "");
    }

    _invokeMeetingWindow: (*) => void;


    /**
     * Open meeting in a separate window.
     * @param {*} config containing the meetingID 
     */
    _invokeMeetingWindow({ config: data }) {
        createMeetingWindow(data);
    }

    _onExplicitIframeReload: (*) => void;

    /**
     * Reload iframe with new iframe URL.
     *
     * @param {Object} obj - data with serverURL in it.
     * @returns {void}
     * @private
     */
    _onExplicitIframeReload(obj: Object) {
        let data = obj.config;
        
        let pathConfig;
        if(data.room) {
            pathConfig = createConferenceObjectFromURL(
                getServerURL() + '/' + data.room);
        }
        else {
            pathConfig = data.options || {};
        }
        
        if (data.loadingMsg) {
            this.setState({
                loadingMsg: data.loadingMsg
            })
        }

        if (!pathConfig) {
            return;
        }

        // console.log("this.props.dispatch: ", this.props.dispatch);
        let path = data.room ? '/conference': '/';
        this.props.dispatch(push('/temp'));
        this.props.dispatch(push(path, pathConfig));
    }

    /**
     * Implements React's {@link Component#render()}.
     *
     * @returns {ReactElement}
     */
    render() {
        return (
            <Wrapper innerRef = { this._ref }>
                { this._maybeRenderLoadingIndicator() }
            </Wrapper>
        );
    }

    /**
     * Load the conference by creating the iframe element in this component
     * and attaching utils from jifmeet-electron-utils.
     *
     * @returns {void}
     */
    _loadConference() {
        // this._onExplicitScreenshareInit();

        const url = new URL(this._conference.room, this._conference.serverURL);
        const roomName = url.pathname.split('/').pop();
        const host = this._conference.serverURL.replace(/https?:\/\//, '');
        const searchParameters = Object.fromEntries(url.searchParams);
        const locale = { lng: i18n.language };
        const urlParameters = {
            ...searchParameters,
            ...locale
        };
        
        // let configSplit;
        // let configObj = {};
        // if(url.hash) {
        //     configSplit = url.hash.substring(1).split("&");
        //     for(let i = 0; i < configSplit.length; i++) {
        //         let param = configSplit[i].split("=")
        //         if(param.length > 1 && param[0].startsWith("config.")) {
        //             let val = param[1];
        //             try {
        //                 val = JSON.parse(param[1])
        //             }
        //             catch(e) {
        //             }
                    
        //             configObj[param[0].split(".")[1]] = val;
        //         }
        //     }
        // }

        // const configOverwrite = Object.assign({},{
        //     startWithAudioMuted: this.props._startWithAudioMuted,
        //     startWithVideoMuted: this.props._startWithVideoMuted
        // }, configObj );

        const configOverwrite = {
            startWithAudioMuted: this.props._startWithAudioMuted,
            startWithVideoMuted: this.props._startWithVideoMuted
        };

        const options = {
            configOverwrite,
            onload: this._onIframeLoad,
            parentNode: this._ref.current,
            roomName
        };

        this._api = new JitsiMeetExternalAPI(host, {
            ...options,
            ...urlParameters
        });

        this._api.on('invokeMeetingWindow', this._invokeMeetingWindow)
        this._api.on('explicitIframeReload', this._onExplicitIframeReload);
        this._api.on('updateAppBadge', this._updateAppBadge);

        this._api.on('liveMessage', ({
                from,
                id,
                message,
                stamp
            }) => {
            new Notification(`${from || ''}`, {
                body: message
            });
        });

        this._api.on('suspendDetected', this._onVideoConferenceEnded);
        this._api.on('readyToClose', this._onVideoConferenceEnded);
        this._api.on('videoConferenceJoined',
            (conferenceInfo: Object) => {
                // this.props.dispatch(conferenceJoined(this._conference));
                // this._onVideoConferenceJoined(conferenceInfo);
            }
        );

        // this._api.on('explicitScreenshareInit', this._onExplicitScreenshareInit);

        const { RemoteControl,
            setupScreenSharingRender,
            setupAlwaysOnTopRender,
            initPopupsConfigurationRender,
            setupWiFiStats,
            setupPowerMonitorRender
        } = window.jitsiNodeAPI.jitsiMeetElectronUtils;

        initPopupsConfigurationRender(this._api);

        const iframe = this._api.getIFrame();

        setupScreenSharingRender(this._api);

        if (ENABLE_REMOTE_CONTROL) {
            new RemoteControl(iframe); // eslint-disable-line no-new
        }

        // Allow window to be on top if enabled in settings
        if (this.props._alwaysOnTopWindowEnabled) {
            setupAlwaysOnTopRender(this._api);
        }

        setupWiFiStats(iframe);
        setupPowerMonitorRender(this._api);
    }

    /**
     * It renders a loading indicator, if appropriate.
     *
     * @returns {?ReactElement}
     */
    _maybeRenderLoadingIndicator() {
        if (this.state.isLoading) {
            return (
                <LoadingIndicator>
                    <Loading message={this.state.loadingMsg} />
                </LoadingIndicator>
            );
        }
    }

    /**
     * Navigates to home screen (Welcome).
     *
     * @param {Event} event - Event by which the function is called.
     * @param {string} room - Room name.
     * @param {string} serverURL - Server URL.
     * @returns {void}
     */
    _navigateToHome(event: Event, room: ?string, serverURL: ?string) {
        this.props.dispatch(push('/', {
            error: event.type === 'error',
            room,
            serverURL,
            loadingMsg: event.options && event.options.loadingMsg
        }));
    }

    _onVideoConferenceEnded: (*) => void;

    /**
     * Dispatches conference ended and navigates to home screen.
     *
     * @param {Event} event - Event by which the function is called.
     * @returns {void}
     * @private
     */
    _onVideoConferenceEnded(event: Event, options) {
        this.props.dispatch(conferenceEnded(this._conference));
        this._navigateToHome(event);
    }

    /**
     * Updates redux state's user name from conference.
     *
     * @param {Object} params - Returned object from event.
     * @param {string} id - Local Participant ID.
     * @returns {void}
     */
    _onDisplayNameChange(params: Object, id: string) {
        if (params.id === id) {
            this.props.dispatch(setName(params.displayname));
        }
    }

    /**
     * Updates redux state's email from conference.
     *
     * @param {Object} params - Returned object from event.
     * @param {string} id - Local Participant ID.
     * @returns {void}
     */
    _onEmailChange(params: Object, id: string) {
        if (params.id === id) {
            this.props.dispatch(setEmail(params.email));
        }
    }

    _onIframeLoad: (*) => void;

    /**
     * Sets state of loading to false when iframe has completely loaded.
     *
     * @returns {void}
     */
    _onIframeLoad() {
        if (this._loadTimer) {
            clearTimeout(this._loadTimer);
            this._loadTimer = null;
        }

        this.setState({
            isLoading: false
        });
    }

    /**
     * Saves conference info on joining it.
     *
     * @param {Object} conferenceInfo - Contains information about the current
     * conference.
     * @returns {void}
     */
    _onVideoConferenceJoined(conferenceInfo: Object) {
        this._setEmail(this.props._email);
        this._setName(this.props._name);

        const { id } = conferenceInfo;

        this._api.on('displayNameChange',
            (params: Object) => this._onDisplayNameChange(params, id));
        this._api.on('emailChange',
            (params: Object) => this._onEmailChange(params, id));
    }

    /**
     * Set email from settings to conference.
     *
     * @param {string} email - Email of user.
     * @returns {void}
     */
    _setEmail(email: string) {
        this._api.executeCommand('email', email);
    }

    /**
     * Set name from settings to conference.
     *
     * @param {string} name - Name of user.
     * @returns {void}
     */
    _setName(name: string) {
        this._api.executeCommand('displayName', name);
    }

}

/**
 * Maps (parts of) the redux state to the React props.
 *
 * @param {Object} state - The redux state.
 * @returns {Props}
 */
function _mapStateToProps(state: Object) {
    return {
        _alwaysOnTopWindowEnabled: getSetting(state, 'alwaysOnTopWindowEnabled', true),
        _email: state.settings.email,
        _name: state.settings.name,
        _serverURL: state.settings.serverURL,
        _serverTimeout: state.settings.serverTimeout,
        _startWithAudioMuted: state.settings.startWithAudioMuted,
        _startWithVideoMuted: state.settings.startWithVideoMuted
    };
}

export default connect(_mapStateToProps)(Conference);
