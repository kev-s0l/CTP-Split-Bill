import { currentUserId } from "@project/auth";
//import {} from "project/domain";

export async function PUT(req: Request){
    try{
        const me = await currentUserId();

    } catch{

    }







    return;
}
