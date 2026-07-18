const { createInvitationDelivery } = require("../delivery/invitationDelivery");

function createInvitationOutbox({ delivery = createInvitationDelivery() } = {}) {
    if (
        !delivery ||
        typeof delivery.assertAvailable !== "function" ||
        typeof delivery.send !== "function"
    ) {
        throw new TypeError("Invitation outbox requires an invitation delivery adapter.");
    }

    return {
        assertAvailable() {
            delivery.assertAvailable();
        },
        async publish(message) {
            return delivery.send(message);
        }
    };
}

module.exports = {
    createInvitationOutbox
};
