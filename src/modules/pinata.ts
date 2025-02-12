import { PinataSDK } from "pinata-web3";

export function createPinataClient(jwt: string, gateway: string): PinataSDK {
    return new PinataSDK({
        pinataJwt: jwt,
        pinataGateway: gateway,
    });
}
