const { rejects } = require('assert');
const { resolve } = require('path');
const equal = require('fast-deep-equal');
const axios = require('axios');

module.exports = function(RED) {
    function STechCloudConfigNode(config) {
        RED.nodes.createNode(this, config);

		var node = this;

		const id = this.id;

		this.name = config.name;

		const model = config.model;

		var WebSocket = require('ws');
		const fs  = require('fs');

		var ws;

		var configfile = "./s-tech-alice-conf.json";    // файл с конфигурацией

		var tokenfile = "./s-tech-token.json";			// файл с токеном

		const host = node.credentials.host; // host сервиса из конфига ноды
		const port = node.credentials.port; // port сервиса из конфига ноды

		const login = node.credentials.login;   // ID пользователя
		const password = node.credentials.password;   // пароль пользователя
		var token = node.credentials.token;   // Токен пользователя

		var controller_serial;

		var devices = new Array() ;
		var devicesfi = new Array() ;
		var devcount = 0;

		var devicessti = new Array() ;
		var devcountst = 0;

		var devicesssti = new Array() ;
		var devcountsst = 0;

		global.Flow_Cloud_loaded = false;
		var serld = false;

		var read_token = false;

		var devfornotifi = new Array();

		var test_msg_send = false;

		var normalclose = false

		var DevicesInfo= {
			request_id: "",
			payload: {
				user_id: "",
				devices: []
			}
		}

		var DevicesState= {
			request_id: "",
			payload: {
				devices: []
			}
		}

		var ResponceDevicesState= {
			request_id: "",
			payload: {
				devices: []
			}
		}

		var UpdateStateDevice = {
			ts: 0,
			payload: {
				user_id: login,
				devices: []
			}
		}

		var UpdateDevices = {
			ts: 0,
			payload: {
				user_id: login
			}
		}

		// Функция чтения токена
		function readtoken (){
			if (typeof token === "undefined") {
				return;
			}
			fs.readFile(tokenfile, {encoding: 'utf8'}, (err, data) => {
				if (err) {
					var wrdata = [];
					wrdata.push({id: id, token: token});
					wrdata = JSON.stringify(wrdata, null, 2);
					fs.writeFile(tokenfile, wrdata, { encoding: 'utf8', flag: 'w' }, function(){
						read_token = true;
						return;
					});
				}
				else{
					try{
						var dt = JSON.parse(data);
						if (typeof dt === 'object'){
							dt.forEach(datatok => {
								if (datatok.id === id){
									token = datatok.token;
									read_token = true;
								}
							});
						}
						if (read_token === false) {
							throw new SyntaxError("Токен из файла не прочитан.");
						}
					}
					catch{
							node.log("С файлом токена что-то не так... Перезаписываю файл.")
							var wrdata = [];
							wrdata.push({id: id, token: token});
							wrdata = JSON.stringify(wrdata, null, 2);
							fs.writeFile(tokenfile, wrdata, { encoding: 'utf8', flag: 'w' }, function(){});
							read_token = true;
					}
				}
			});
		}

		// Функция получения текущего времени в секундах
		function getTimestampInSeconds () {
			return (Date.now() / 1000).toFixed(3)
		  }

		// Функция получения серийного номера контроллера
		function getserial (){
			try {
			 const data = fs.readFileSync('/var/lib/wirenboard/short_sn.conf', 'utf8');
			 controller_serial = data.trim();
			 node.log('serial:' + controller_serial);
			} catch (err) {
			 controller_serial = "ERROR_SERIAL_NUMBER";
			 node.error(err);
			}
			// controller_serial = "ABCDEFGH";
			node.emit("controller_serial", controller_serial);
			serld = true;
		}

		const GetDeviceInfo = new Promise ((resolve, reject) => {
			node.AddDevInfo = (data) => {
				devicesfi.push(data);
				devcount = devcount - 1;
				if (devcount < 1) {
					resolve();
				}
		   	}
		});

		const GetDeviceState = new Promise ((resolve, reject) => {
			node.AddDevState = (data) => {
				devicessti.push(data);
				devcountst = devcountst - 1;
				if (devcountst < 1) {
					resolve();
				}
		   	}
		});

		const SetDeviceState = new Promise ((resolve, reject) => {
			node.ResponceState = (data) =>{
				devicesssti.push(data);
				devcountsst = devcountsst - 1;
				if (devcountsst < 1) {
			 		resolve();
		   		}
			}
		});

		function RequestDevInfo (reqid, model){   // Функция сбора информации о устройствах в облако
			return new Promise  ((resolve, reject) => {
				let RequiestID = reqid;
				let di = DevicesInfo;
				devcount = devices.length;
				devicesfi = [];
				devices.forEach(function(dev){
					node.emit("Get Info", dev, model);
				});
				GetDeviceInfo
				.then (() => {
					di.request_id = RequiestID;
					di.payload.user_id = login;
					di.payload.devices = devicesfi;
					resolve (di);
				})
				.catch (() => {
					reject;
				})
			})
		}

		function GetStateDevices (reqid, data){   // Функция сбора информации о состоянии устройств в облако
			return new Promise  ((resolve, reject) => {
				let RequiestID = reqid;
				let dev = data;
				devcountst = dev.devices.length;
				devicessti =[];
				dev.devices.forEach(function(devst){
					if ( devices.includes(devst.id) === false ){
						let Resp = {};
						Resp.id = devst.id;
						Resp.error_code = "DEVICE_NOT_FOUND";
						Resp.error_message = "The specified device was not found";
						node.AddDevState (Resp);
					}
					node.emit("Get State", devst);
				})
				GetDeviceState
				.then (() => {
					let ds = DevicesState;
					ds.request_id = RequiestID;
					ds.payload.devices = devicessti;
					resolve (ds);
				})
				.catch (() => {
					reject;
				})
			})
		}

		function SetStateDevices (reqid, data){   // Функция установки состояния устройств по команде из облака
			return new Promise  ((resolve, reject) => {
				let RequiestID = reqid;
				let dev = data;
				devcountsst = dev.devices.length;
				devicesssti =[];

				dev.devices.forEach(function(devst){
					if ( devices.includes(devst.id) === false ){
						let Resp = {};
						Resp.id = devst.id
						Resp.action_result = {
							status : 'ERROR', error_code : "DEVICE_NOT_FOUND"
						};
						node.ResponceState (Resp);
					}
					node.emit("Set State", devst);
				});
				SetDeviceState
				.then (() => {
					let rds = ResponceDevicesState;
					rds.request_id = RequiestID;
					rds.payload.devices = devicesssti;
					resolve (rds);
				})
				.catch (() => {
					reject;
				})
			})
		}

		RED.httpAdmin.get("/STechCloudnode/api", RED.auth.needsPermission('node-red-contrib-s-tech-alice.read'), function(req, res) {
			let out = {};
			getserial();
			if (controller_serial != ""){
				out.serial = controller_serial
				res.json(out);
			}
			else{
				node.error("No serial");
			}
		});

		function connect() {

			normalclose = false;

			node.log("Start connect to cloud...");

			let url = "https://" + host + ":" + port + "/api/controller/websocket";
			//let url = "https://s-tech-cloud.ru:8088/api/controller/websocket";

			ws = new WebSocket(url, {
				headers: {
				'Authorization': token
			}
			});

				ws.on('open', function open() {
					node.emit("online");
					node.log('Connected to ' + url);
				});

				ws.on('message', function incoming(data) {
					if ( test_msg_send === true && data.toString() === "200 OK" ){
						node.log ("Response to test message received");
						test_msg_send = false;
						return;
					}
					try{
						let inmsg = JSON.parse(data);
						switch (inmsg.Function){
							case "Get Devices Info":
								node.log("Request Devices Info. Requeest ID: " + inmsg.XRequestId);
								RequestDevInfo (inmsg.XRequestId, model)
								.then ( res => {
									console.log (JSON.stringify(res, null, 2))
									ws.send (JSON.stringify(res));
									node.log("Send to cloud Devices Info. Requeest ID: " + res.request_id);
								})
								.catch (() => {
									ws.send ({Error: "External error"});
								})
							break;
							case "Get Devices State":
								node.log("Request Devices State. Requeest ID: " + inmsg.XRequestId);
								GetStateDevices (inmsg.XRequestId, inmsg.DeviceList)
								.then ( res => {
									ws.send (JSON.stringify(res));
									node.log("Send to cloud Devices State. Requeest ID: " + res.request_id);
								})
								.catch (() => {
									ws.send ({Error: "External error"});
								})
							break;
							case "Set Devices State":
								node.log("Devices Status change request. Requeest ID: " + inmsg.XRequestId);
								SetStateDevices (inmsg.XRequestId, inmsg.DeviceList.payload)
								.then ( res => {
									ws.send (JSON.stringify(res));
									node.log("Send to cloud confirmation new action devices. Requeest ID: " + res.request_id);
								})
								.catch (() => {
									ws.send ({Error: "External error"});
								})
							break;
							default:
								ws.send ({Error :"Function not found"});
						}
					}
					catch{}
				});

				ws.on('close', function close(code, reason) {
					if (normalclose == false){
						node.emit("offline");
						node.log('Disconnected from ' + url);
						node.error('Код закрытия WebSocket: ' + code.toString());
						if (code === 1008){
							node.UpdateToken();
						}
						setTimeout(connect, 5000); // Переподключиться через 5 секунд после разрыва связи
					}
				});

				ws.on('unexpected-response', (req, res) => {
					if (res.statusCode === 401){
						node.emit("offline");
						node.log('WebSocket Error: Unexpected server response: 401');
						node.UpdateToken();
						ws.close();
					}
				});

				ws.on('error', function (error) {
					node.emit('offline');
					node.error('Ошибка WebSocket: ' + error.toString());
				});
		};

		node.UpdateToken = () =>{
			node.log("Токен не работает. Обновляю токен.");
			let url = "https://" + host + ":" + port + "/api/controller/create/token/updateJWTToken"; 
			axios.post(url, {
				user_id: login,
				password: password,
				jwtToken: token
			})
			.then(function (response) {
				if (response.data.hasOwnProperty('jwtToken') === true){
					node.log("Новый токен получен.");
					token = response.data.jwtToken;
					var wrdata = []; 
					wrdata.push({id: id, token: token});
					wrdata = JSON.stringify(wrdata, null, 2); 
					fs.writeFile(tokenfile, wrdata, { encoding: 'utf8', flag: 'w' }, function(){});	
				}	
			})
			.catch(function (error) {
				node.log("Ошибка обновления токена. " + error);
			});
		}

		node.AddDevice = (id) => {
			devices.push(id);
		};

		node.UpdateStateDevice = (data) =>{
			UpdateStateDevice.ts = Number(getTimestampInSeconds());
			devfornotifi = [];
			devfornotifi.push(data);
			UpdateStateDevice.payload.devices = devfornotifi;
			let outmsg = {};
			outmsg.command = "Callback State";
			outmsg.payload = UpdateStateDevice;
			ws.send (JSON.stringify(outmsg));
			node.log("Cloud notification of state changes.");
		}

		node.UpdateDevices = () =>{
			UpdateDevices.ts = Number(getTimestampInSeconds());
			let outmsg = {};
			outmsg.command = "Callback Discovery";
			outmsg.payload = UpdateDevices;
			ws.send (JSON.stringify(outmsg));
			node.log("Cloud notification about changing device settings.");
		}

		async function writeJsonFile(filePath, obj) {
			try {
			  const data = JSON.stringify(obj, null, 2);
			  fs.writeFile(filePath, data, { encoding: 'utf8', flag: 'w' }, function(){});
			  node.log('Файл конфигурации ' + configfile + ' успешно записан.');
			} catch (error) {
			  node.error("Ошибка при записи файла конфигурации:" + error);
			}
		}

		function CheckConfig(){
			fs.readFile(configfile, {encoding: 'utf8'}, (err, data) => {
				if (err) {
					node.error('Ошибка при чтении файла конфигурации: ' + err);
					RequestDevInfo ("Config", model)
					.then ( res => {
						writeJsonFile (configfile, res.payload.devices)
					})
					.catch (() => {
						node.log ("не удалось собрать инфо по конфигурации")
					})
					return;
				}
				RequestDevInfo ("Config", model)
				.then ( res => {
					if ( equal(res.payload.devices,JSON.parse(data)) === true ){
						node.log ("Конфигурация не изменилась!")
					}
					else{
						node.log ("Конфигурация изменилась!")
						node.UpdateDevices();
						writeJsonFile (configfile, res.payload.devices);
					}
				})
				.catch (() => {
					node.log ("не удалось собрать инфо по конфигурации")
				})
			});
		}

		getserial();
		readtoken();

		const tokenint = setInterval(() => {
			if (read_token === true){
				connect();
				clearInterval(tokenint);
			}
		}, 50)

		const intrvl = setInterval(() => {
			if (serld === true){
				node.emit("controller_serial", controller_serial);
				setTimeout ( function () { global.Flow_Cloud_loaded = true}, 0);
				clearInterval(intrvl);
			}
		}, 50)

		const confintrvl = setInterval(() => {
			try{
				if ( ws != null && ws.readyState === WebSocket.OPEN){
					CheckConfig();
					clearInterval(confintrvl);
				}
			}
			catch{}
		}, 300);

		setInterval(() => {
			try{
				if ( ws.readyState === WebSocket.OPEN ){
					test_msg_send = true;
					let outmsg = {};
					outmsg.command = "Test Connect";
					ws.send(JSON.stringify(outmsg));
					node.log("Test connect message send");
				}
			}
			catch{}
		}, 120000);

		node.on('close', async (done) => {
		try {
			if (ws && ws.readyState === WebSocket.OPEN) {
			await new Promise((resolve, reject) => {
				normalclose = true;
				ws.close(1000, "Normal closure");
				resolve();
			});
			node.log('Normal websocket closing');
			}
		} catch (err) {
			node.error('Error closing connection: ' + err.message);
		} finally {
			done(); // Вызываем done() в finally, чтобы гарантировать его выполнение
		}
		});

    }
    RED.nodes.registerType("S-Tech-cloud", STechCloudConfigNode,{
		credentials:{
			host: {type: "text"},
			port: {type: "text"},
			login:{type:"text"},
			password:{type:"text"},
			token:{type:"password"}
		}
	});
}
