'use client'

import { useEffect, useState } from "react"
import { createClient } from "@/utils/supabase/client"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useRouter } from "next/navigation"
import { notifications } from "@/utils/notifications"
import { FileUpload } from "@/components/file-upload"
import { TicketFeedback } from "@/components/ticket-feedback"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type Ticket = {
    id: string
    subject: string
    description: string
    status: 'open' | 'pending' | 'closed'
    priority: 'low' | 'normal' | 'high'
    created_at: string
    updated_at: string
}

type Message = {
    id: string
    ticket_id: string
    message_body: string
    role: 'customer' | 'agent' | 'admin'
    created_at: string
    read_by_customer: boolean
    read_by_agent: boolean
}

type File = {
    id: string
    file_name: string
    content_type: string
    storage_path: string
}

export default function TicketDetailPage({ params }: { params: { id: string } }) {
    const router = useRouter()
    const supabase = createClient()
    const [ticket, setTicket] = useState<Ticket | null>(null)
    const [messages, setMessages] = useState<Message[]>([])
    const [files, setFiles] = useState<File[]>([])
    const [newMessage, setNewMessage] = useState("")
    const [newFileIds, setNewFileIds] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [sending, setSending] = useState(false)
    const [showFeedback, setShowFeedback] = useState(false)

    useEffect(() => {
        fetchTicketAndMessages()
        markMessagesAsRead()

        const channel = supabase
            .channel('ticket-detail')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'ticket_messages',
                    filter: `ticket_id=eq.${params.id}`
                },
                (payload) => {
                    const newMessage = payload.new as Message
                    setMessages(prev => [...prev, newMessage])
                    if (newMessage.role !== 'customer') {
                        markMessageAsRead(newMessage.id)
                    }
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [params.id])

    const fetchTicketAndMessages = async () => {
        try {
            // Fetch ticket details
            const { data: ticketData, error: ticketError } = await supabase
                .from('tickets')
                .select('*')
                .eq('id', params.id)
                .single()

            if (ticketError) throw ticketError
            setTicket(ticketData)

            // Fetch messages
            const { data: messagesData, error: messagesError } = await supabase
                .from('ticket_messages')
                .select('*')
                .eq('ticket_id', params.id)
                .order('created_at', { ascending: true })

            if (messagesError) throw messagesError
            setMessages(messagesData)

            // Fetch files
            const { data: filesData, error: filesError } = await supabase
                .from('ticket_files')
                .select(`
                    file:files (
                        id,
                        file_name,
                        content_type,
                        storage_path
                    )
                `)
                .eq('ticket_id', params.id)

            if (filesError) throw filesError
            setFiles(filesData.map(f => f.file))

            // Check if we should show feedback
            const { data: feedbackData } = await supabase
                .from('ticket_feedback')
                .select('id')
                .eq('ticket_id', params.id)
                .single()

            setShowFeedback(ticketData.status === 'closed' && !feedbackData)
        } catch (error) {
            notifications.error('Failed to load ticket details')
            console.error('Error:', error)
        } finally {
            setLoading(false)
        }
    }

    const markMessagesAsRead = async () => {
        try {
            await supabase
                .from('ticket_messages')
                .update({ read_by_customer: true })
                .eq('ticket_id', params.id)
                .neq('role', 'customer')
        } catch (error) {
            console.error('Error marking messages as read:', error)
        }
    }

    const markMessageAsRead = async (messageId: string) => {
        try {
            await supabase
                .from('ticket_messages')
                .update({ read_by_customer: true })
                .eq('id', messageId)
        } catch (error) {
            console.error('Error marking message as read:', error)
        }
    }

    const handleSendMessage = async () => {
        if (!newMessage.trim() && newFileIds.length === 0) return

        setSending(true)
        try {
            // Add message if there is one
            if (newMessage.trim()) {
                const { error: messageError } = await supabase
                    .from('ticket_messages')
                    .insert({
                        ticket_id: params.id,
                        message_body: newMessage,
                        role: 'customer'
                    })

                if (messageError) throw messageError
            }

            // Link files if any
            if (newFileIds.length > 0) {
                const { error: filesError } = await supabase
                    .from('ticket_files')
                    .insert(
                        newFileIds.map(fileId => ({
                            ticket_id: params.id,
                            file_id: fileId
                        }))
                    )

                if (filesError) throw filesError
            }

            setNewMessage("")
            setNewFileIds([])
        } catch (error) {
            notifications.error('Failed to send message')
            console.error('Error:', error)
        } finally {
            setSending(false)
        }
    }

    const handleCloseTicket = async () => {
        try {
            const { error } = await supabase
                .from('tickets')
                .update({ status: 'closed' })
                .eq('id', params.id)

            if (error) throw error

            setTicket(prev => prev ? { ...prev, status: 'closed' } : null)
            notifications.success('Ticket closed successfully')
        } catch (error) {
            notifications.error('Failed to close ticket')
            console.error('Error:', error)
        }
    }

    const handleReopenTicket = async () => {
        try {
            const { error } = await supabase
                .from('tickets')
                .update({ status: 'open' })
                .eq('id', params.id)

            if (error) throw error

            setTicket(prev => prev ? { ...prev, status: 'open' } : null)
            notifications.success('Ticket reopened successfully')
        } catch (error) {
            notifications.error('Failed to reopen ticket')
            console.error('Error:', error)
        }
    }

    const getFileUrl = async (path: string) => {
        const { data } = supabase.storage
            .from('attachments')
            .getPublicUrl(path)
        return data.publicUrl
    }

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high':
                return 'bg-red-500'
            case 'normal':
                return 'bg-yellow-500'
            case 'low':
                return 'bg-green-500'
            default:
                return 'bg-gray-500'
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open':
                return 'bg-green-500'
            case 'pending':
                return 'bg-yellow-500'
            case 'closed':
                return 'bg-gray-500'
            default:
                return 'bg-gray-500'
        }
    }

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        )
    }

    if (!ticket) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center">
                    <h2 className="text-2xl font-bold">Ticket not found</h2>
                    <Button
                        className="mt-4"
                        onClick={() => router.push('/customer/tickets')}
                    >
                        Back to tickets
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">{ticket.subject}</h1>
                    <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2">
                                        Priority:
                                        <div className={`h-2 w-2 rounded-full ${getPriorityColor(ticket.priority)}`} />
                                        {ticket.priority}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {ticket.priority === 'high' && "Urgent issue requiring immediate attention"}
                                    {ticket.priority === 'normal' && "Standard priority issue"}
                                    {ticket.priority === 'low' && "Non-urgent issue that can be addressed later"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div className="flex items-center gap-2">
                                        Status:
                                        <div className={`h-2 w-2 rounded-full ${getStatusColor(ticket.status)}`} />
                                        {ticket.status}
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {ticket.status === 'open' && "Ticket is active and awaiting response"}
                                    {ticket.status === 'pending' && "Ticket is awaiting your response"}
                                    {ticket.status === 'closed' && "Ticket has been resolved"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <span>Created: {new Date(ticket.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    {ticket.status === 'open' ? (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline">Close Ticket</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Close this ticket?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will mark the ticket as resolved. You can still view the ticket history and reopen it if needed.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleCloseTicket}>
                                        Close Ticket
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    ) : ticket.status === 'closed' ? (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="outline">Reopen Ticket</Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Reopen this ticket?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will reopen the ticket for further discussion. You'll be able to add new messages.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleReopenTicket}>
                                        Reopen Ticket
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    ) : null}
                    <Button
                        variant="outline"
                        onClick={() => router.push('/customer/tickets')}
                    >
                        Back to tickets
                    </Button>
                </div>
            </div>

            <Card className="p-6">
                <h2 className="font-semibold mb-2">Description</h2>
                <p className="text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>
            </Card>

            {files.length > 0 && (
                <Card className="p-6">
                    <h2 className="font-semibold mb-4">Attachments</h2>
                    <div className="space-y-2">
                        {files.map((file) => (
                            <div
                                key={file.id}
                                className="flex items-center justify-between p-2 rounded-md border bg-background"
                            >
                                <span className="text-sm">{file.file_name}</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                        const url = await getFileUrl(file.storage_path)
                                        window.open(url, '_blank')
                                    }}
                                >
                                    Download
                                </Button>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            <div className="space-y-4">
                <h2 className="font-semibold">Messages</h2>
                <div className="space-y-4">
                    {messages.map((message) => (
                        <Card
                            key={message.id}
                            className={`p-4 ${message.role === 'customer' ? 'ml-12' : 'mr-12'}`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <Badge variant={message.role === 'customer' ? "default" : "secondary"}>
                                    {message.role}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                    {new Date(message.created_at).toLocaleString()}
                                </span>
                            </div>
                            <p className="whitespace-pre-wrap">{message.message_body}</p>
                        </Card>
                    ))}
                </div>

                {ticket.status !== 'closed' ? (
                    <div className="space-y-4">
                        <FileUpload
                            ticketId={params.id}
                            onUploadComplete={setNewFileIds}
                        />
                        <div className="space-y-2">
                            <Textarea
                                placeholder="Type your message..."
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                className="min-h-[100px]"
                            />
                            <div className="flex justify-end">
                                <Button
                                    onClick={handleSendMessage}
                                    disabled={sending || (!newMessage.trim() && newFileIds.length === 0)}
                                >
                                    {sending ? "Sending..." : "Send Message"}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : showFeedback ? (
                    <TicketFeedback
                        ticketId={params.id}
                        onFeedbackSubmit={() => setShowFeedback(false)}
                    />
                ) : null}
            </div>
        </div>
    )
} 