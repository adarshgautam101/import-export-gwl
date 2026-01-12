import { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    switch (topic) {
        case "CUSTOMERS_DATA_REQUEST":

            // Process the request to export customer data
            // For this app, we would look up the customer in our DB and email the data to the merchant/customer
            break;

        case "CUSTOMERS_REDACT":

            // Process the request to delete customer data
            // For this app, we would delete the customer from our local DB
            break;

        case "SHOP_REDACT":

            // Process the request to delete shop data (app uninstall/closure)
            // For this app, we would delete all data associated with this shop
            break;

        default:
            throw new Response("Unhandled webhook topic", { status: 404 });
    }

    return new Response();
};
